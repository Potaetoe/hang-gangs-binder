/**
 * The form builder (DESIGN.md feature 3; owner rulings 2026-08-24):
 * admins edit the fields table, and the member form, the charts and
 * the filters follow with no code change - that is the acceptance
 * test. The rulings, in code:
 *
 * - Height, weight and BMI are essential: they cannot be retired or
 *   deleted, only renamed.
 * - A new choice field starts retired ("draft") and cannot go on the
 *   form until it has at least one option.
 * - Renaming an option rewrites every stored value to the new
 *   spelling, so history stays one filterable thing.
 * - Removing an option only stops new picks; members who carry it
 *   keep it, and charts keep counting it.
 * - Deleting is only for a field that never collected a value.
 * - Every action writes the admin change log.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import { runBatch, type Writes } from './db';
import { logAdminQuery } from './admin';
import { choicePicks, fieldOptions, type Field } from './stats';
import { describeFormula, isCalculated, parseFormula, type Formula, type Operand } from './calc';
import { randomToken } from './crypto';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export const ESSENTIAL = new Set(['height', 'weight', 'bmi']);

export const NAME_MAX = 40;
export const OPTION_MAX = 60;

export type FieldKind = 'choice' | 'multi' | 'mass' | 'length' | 'plain' | 'calculated';

export async function allFields(db: Db): Promise<Field[]> {
	return db.select().from(table.fields).orderBy(asc(table.fields.position));
}

async function fieldById(db: Db, id: string): Promise<Field | undefined> {
	return (await db.select().from(table.fields).where(eq(table.fields.id, id)))[0];
}

const cleanName = (raw: string): string => raw.trim().slice(0, NAME_MAX);

export type AddResult = { ok: true; id: string } | { ok: false; reason: 'bad-name' };

/** A number field goes straight on the form; a choice field starts
 * retired until it has options to offer, and a calculated one until
 * it has a working recipe (owner ruling 2026-08-26). */
export async function addField(
	db: Db,
	date: string,
	actorId: string,
	nameRaw: string,
	kind: FieldKind
): Promise<AddResult> {
	const name = cleanName(nameRaw);
	if (!name) return { ok: false, reason: 'bad-name' };
	const isChoice = kind === 'choice' || kind === 'multi';
	const isCalc = kind === 'calculated';
	const fields = await allFields(db);
	const position = Math.max(0, ...fields.map((f) => f.position)) + 1;
	const id = randomToken(6);
	await runBatch(db, [
		db.insert(table.fields).values({
			id,
			name,
			type: isChoice ? 'choice' : 'number',
			measure: isChoice || isCalc ? null : kind,
			computed: null,
			formula: isCalc ? '{}' : null,
			options: isChoice ? '[]' : null,
			multiple: kind === 'multi',
			position,
			status: isChoice || isCalc ? 'retired' : 'active'
		}),
		logAdminQuery(db, date, actorId, `added the field "${name}"`)
	]);
	return { ok: true, id };
}

/**
 * Writes a calculated field's recipe (owner rulings 2026-08-26).
 * Inputs must be typed number fields - never another calculated one,
 * never a choice. BMI's recipe is locked for good, and every OTHER
 * recipe locks the moment its field holds a stored value (owner
 * ruling 2026-08-26, replacing the editable-formula ruling): every
 * number in a field's history must come from ONE formula, so changing
 * the math means retiring the field and building a new one. While a
 * recipe is still unlocked, every change logs old recipe -> new.
 */
export async function saveFormula(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	formula: Formula
): Promise<SimpleResult> {
	const field = await fieldById(db, id);
	if (!field || !isCalculated(field)) return { ok: false, reason: 'No such calculated field.' };
	if (field.computed === 'bmi') {
		return { ok: false, reason: "BMI's recipe is fixed - it cannot be rewritten." };
	}
	const used = (
		await db
			.select({ fieldId: table.entryValues.fieldId })
			.from(table.entryValues)
			.where(eq(table.entryValues.fieldId, id))
			.limit(1)
	)[0];
	if (used) {
		return {
			ok: false,
			reason:
				'This recipe has collected values, so it is locked - retire the field and build a new one to change the math.'
		};
	}
	const fields = await allFields(db);
	const operands: Operand[] = [formula.start, ...formula.steps.map((s) => s.value)];
	for (const operand of operands) {
		if (operand.kind === 'const') continue;
		const input = fields.find((f) => f.id === operand.id);
		if (!input || input.type !== 'number' || isCalculated(input)) {
			return { ok: false, reason: 'A recipe reads typed number fields only.' };
		}
	}
	const before = parseFormula(field);
	const detail = before
		? `${describeFormula(before, fields)} → ${describeFormula(formula, fields)}`
		: `set to: ${describeFormula(formula, fields)}`;
	await runBatch(db, [
		db
			.update(table.fields)
			.set({ formula: JSON.stringify(formula) })
			.where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `changed the recipe of "${field.name}"`, null, detail)
	]);
	return { ok: true };
}

export type SimpleResult = { ok: true } | { ok: false; reason: string };

export async function renameField(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	nameRaw: string
): Promise<SimpleResult> {
	const name = cleanName(nameRaw);
	if (!name) return { ok: false, reason: 'A field needs a name.' };
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	await runBatch(db, [
		db.update(table.fields).set({ name }).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `renamed the field "${field.name}" to "${name}"`)
	]);
	return { ok: true };
}

/** One-way (owner ruling 2026-08-24): a single-pick choice field can
 * start letting members pick several. Old answers read as one-item
 * picks, so history needs no rewrite - and there is no way back down,
 * because squeezing several picks into one would lose answers. */
export async function makeMultiple(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<SimpleResult> {
	const field = await fieldById(db, id);
	if (!field || field.type !== 'choice') return { ok: false, reason: 'No such choice field.' };
	if (field.multiple) return { ok: false, reason: 'Members already pick several here.' };
	await runBatch(db, [
		db.update(table.fields).set({ multiple: true }).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `let members pick several on "${field.name}"`)
	]);
	return { ok: true };
}

/** Swap positions with the neighbour above or below, active fields
 * only - the form's order is what is being arranged. */
export async function moveField(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	direction: 'up' | 'down'
): Promise<SimpleResult> {
	const fields = (await allFields(db)).filter((f) => f.status === 'active');
	const index = fields.findIndex((f) => f.id === id);
	if (index < 0) return { ok: false, reason: 'No such field.' };
	const other = fields[direction === 'up' ? index - 1 : index + 1];
	if (!other) return { ok: true };
	const a = fields[index];
	// One batch: half a swap is two fields on one position (hardening
	// pass, 2026-08-26).
	await runBatch(db, [
		db.update(table.fields).set({ position: other.position }).where(eq(table.fields.id, a.id)),
		db.update(table.fields).set({ position: a.position }).where(eq(table.fields.id, other.id)),
		logAdminQuery(db, date, actorId, `moved the field "${a.name}" ${direction}`)
	]);
	return { ok: true };
}

export async function retireField(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<SimpleResult> {
	if (ESSENTIAL.has(id)) {
		return { ok: false, reason: 'Height, weight and BMI are essential - they cannot be retired.' };
	}
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	await runBatch(db, [
		db.update(table.fields).set({ status: 'retired' }).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `retired the field "${field.name}"`)
	]);
	return { ok: true };
}

export async function reviveField(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<SimpleResult> {
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	if (field.type === 'choice' && fieldOptions(field).length === 0) {
		return {
			ok: false,
			reason: 'A choice field needs at least one option before it goes on the form.'
		};
	}
	if (isCalculated(field) && !parseFormula(field)) {
		return {
			ok: false,
			reason: 'A calculated field needs a working recipe before it goes on the form.'
		};
	}
	await runBatch(db, [
		db.update(table.fields).set({ status: 'active' }).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `put the field "${field.name}" on the form`)
	]);
	return { ok: true };
}

/** Deleting is only for a field that never collected a value; a field
 * with history retires instead. */
export async function deleteField(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<SimpleResult> {
	if (ESSENTIAL.has(id)) {
		return { ok: false, reason: 'Height, weight and BMI are essential - they cannot be deleted.' };
	}
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	const used = (
		await db
			.select({ fieldId: table.entryValues.fieldId })
			.from(table.entryValues)
			.where(eq(table.entryValues.fieldId, id))
			.limit(1)
	)[0];
	if (used) {
		return { ok: false, reason: 'This field has collected values - retire it instead.' };
	}
	await runBatch(db, [
		db.delete(table.fields).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `deleted the unused field "${field.name}"`)
	]);
	return { ok: true };
}

/* ---------------------------------------------------------------- */
/* Options                                                           */

/** The option-list update as an unexecuted statement, for batching
 * with whatever else the action changes. */
function optionsQuery(db: Db, id: string, options: string[]) {
	return db
		.update(table.fields)
		.set({ options: JSON.stringify(options) })
		.where(eq(table.fields.id, id));
}

const cleanOption = (raw: string): string => raw.trim().slice(0, OPTION_MAX);

export async function addOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	optionRaw: string
): Promise<SimpleResult> {
	const option = cleanOption(optionRaw);
	if (!option) return { ok: false, reason: 'An option needs a name.' };
	const field = await fieldById(db, id);
	if (!field || field.type !== 'choice') return { ok: false, reason: 'No such choice field.' };
	const options = fieldOptions(field);
	if (options.includes(option)) return { ok: false, reason: 'That option already exists.' };
	await runBatch(db, [
		optionsQuery(db, id, [...options, option]),
		logAdminQuery(db, date, actorId, `added the option "${option}" to "${field.name}"`)
	]);
	return { ok: true };
}

/** Renaming an option rewrites every stored value to the new spelling
 * (owner ruling): history stays one filterable thing. */
export async function renameOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	fromOption: string,
	toRaw: string
): Promise<SimpleResult> {
	const to = cleanOption(toRaw);
	if (!to) return { ok: false, reason: 'An option needs a name.' };
	const field = await fieldById(db, id);
	if (!field || field.type !== 'choice') return { ok: false, reason: 'No such choice field.' };
	const options = fieldOptions(field);
	if (!options.includes(fromOption)) return { ok: false, reason: 'No such option.' };
	if (options.includes(to)) return { ok: false, reason: 'That option already exists.' };
	// The option list, every stored answer and the log line move as ONE
	// batch (hardening pass, 2026-08-26): a rename that dies halfway
	// used to leave history split between two spellings.
	const statements: Writes = [
		optionsQuery(
			db,
			id,
			options.map((o) => (o === fromOption ? to : o))
		),
		// Plain single-pick rows rewrite in one stroke; the SQL equality
		// cannot see inside a pick-several row's JSON list, so those rows
		// rewrite one by one. A switched field carries both shapes.
		db
			.update(table.entryValues)
			.set({ choice: to })
			.where(and(eq(table.entryValues.fieldId, id), eq(table.entryValues.choice, fromOption)))
	];
	if (field.multiple) {
		const rows = await db.select().from(table.entryValues).where(eq(table.entryValues.fieldId, id));
		for (const row of rows) {
			if (!(row.choice ?? '').startsWith('[')) continue;
			const picks = choicePicks(row);
			if (!picks.includes(fromOption)) continue;
			statements.push(
				db
					.update(table.entryValues)
					.set({ choice: JSON.stringify(picks.map((p) => (p === fromOption ? to : p))) })
					.where(and(eq(table.entryValues.entryId, row.entryId), eq(table.entryValues.fieldId, id)))
			);
		}
	}
	statements.push(
		logAdminQuery(
			db,
			date,
			actorId,
			`renamed the option "${fromOption}" to "${to}" on "${field.name}"`
		)
	);
	await runBatch(db, statements);
	return { ok: true };
}

/** Removing an option only stops new picks (owner ruling): members
 * who carry it keep it, and the charts keep counting it. */
export async function removeOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	option: string
): Promise<SimpleResult> {
	const field = await fieldById(db, id);
	if (!field || field.type !== 'choice') return { ok: false, reason: 'No such choice field.' };
	const options = fieldOptions(field);
	if (!options.includes(option)) return { ok: false, reason: 'No such option.' };
	await runBatch(db, [
		optionsQuery(
			db,
			id,
			options.filter((o) => o !== option)
		),
		logAdminQuery(db, date, actorId, `removed the option "${option}" from "${field.name}"`)
	]);
	return { ok: true };
}
