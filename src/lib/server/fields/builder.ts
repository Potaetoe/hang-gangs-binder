/**
 * The form builder (DESIGN.md feature 3). Admins edit field rows and the
 * member form, charts and filters follow with no code change. Every
 * action writes its change-log line in the same batch.
 */

import { and, eq } from 'drizzle-orm';
import type { Db, Writes } from '../db';
import * as table from '../db/schema';
import { runBatch } from '../db';
import { randomToken } from '../crypto';
import { logAdminQuery } from '../changelog';
import { allFields, choicePicks, ESSENTIAL, fieldById, fieldOptions, hasValues } from './fields';
import { describeFormula, isCalculated, parseFormula, recipesReading, type Formula } from './calc';

export const NAME_MAX = 40;
export const OPTION_MAX = 60;

export type FieldKind = 'choice' | 'multi' | 'mass' | 'length' | 'plain' | 'calculated';
export const FIELD_KINDS: FieldKind[] = [
	'choice',
	'multi',
	'mass',
	'length',
	'plain',
	'calculated'
];

export type BuilderResult = { ok: true } | { ok: false; reason: string };

const cleanName = (raw: string): string => raw.trim().slice(0, NAME_MAX);
const cleanOption = (raw: string): string => raw.trim().slice(0, OPTION_MAX);

async function choiceField(db: Db, id: string) {
	const field = await fieldById(db, id);
	return field?.type === 'choice' ? field : undefined;
}

const optionsQuery = (db: Db, id: string, options: string[]) =>
	db
		.update(table.fields)
		.set({ options: JSON.stringify(options) })
		.where(eq(table.fields.id, id));

/** A number field goes straight on the form. A choice field waits until
 * it has options, and a calculated one until it has a working recipe. */
export async function addField(
	db: Db,
	date: string,
	actorId: string,
	nameRaw: string,
	kind: FieldKind
): Promise<{ ok: true; id: string } | { ok: false }> {
	const name = cleanName(nameRaw);
	if (!name) return { ok: false };
	const isChoice = kind === 'choice' || kind === 'multi';
	const isCalc = kind === 'calculated';
	const position = Math.max(0, ...(await allFields(db)).map((f) => f.position)) + 1;
	const id = randomToken(6);
	await runBatch(db, [
		db.insert(table.fields).values({
			id,
			name,
			type: isChoice ? 'choice' : 'number',
			measure: isChoice || isCalc ? null : kind,
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
 * A recipe reads typed number fields only. BMI's is fixed for good, and
 * any other locks once its field holds a value: one field's history must
 * come from one formula, so changing the math means a new field. Until
 * then every change logs old recipe → new.
 */
export async function saveFormula(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	formula: Formula
): Promise<BuilderResult> {
	const field = await fieldById(db, id);
	if (!field || !isCalculated(field)) return { ok: false, reason: 'No such calculated field.' };
	if (field.computed === 'bmi') {
		return { ok: false, reason: "BMI's recipe is fixed - it cannot be rewritten." };
	}
	if (await hasValues(db, id)) {
		return {
			ok: false,
			reason:
				'This recipe has collected values, so it is locked - retire the field and build a new one to change the math.'
		};
	}
	const fields = await allFields(db);
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

export async function renameField(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	nameRaw: string
): Promise<BuilderResult> {
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

/** One-way: old single answers read as one-item picks, but several
 * picks cannot be squeezed back into one without losing answers. */
export async function makeMultiple(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<BuilderResult> {
	const field = await choiceField(db, id);
	if (!field) return { ok: false, reason: 'No such choice field.' };
	if (field.multiple) return { ok: false, reason: 'Members already pick several here.' };
	await runBatch(db, [
		db.update(table.fields).set({ multiple: true }).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `let members pick several on "${field.name}"`)
	]);
	return { ok: true };
}

/** Swaps with the neighbour among fields on the form. One batch, because
 * half a swap leaves two fields on one position. */
export async function moveField(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	direction: 'up' | 'down'
): Promise<BuilderResult> {
	const fields = (await allFields(db)).filter((f) => f.status === 'active');
	const index = fields.findIndex((f) => f.id === id);
	if (index < 0) return { ok: false, reason: 'No such field.' };
	const other = fields[direction === 'up' ? index - 1 : index + 1];
	if (!other) return { ok: true };
	const field = fields[index];
	await runBatch(db, [
		db.update(table.fields).set({ position: other.position }).where(eq(table.fields.id, field.id)),
		db.update(table.fields).set({ position: field.position }).where(eq(table.fields.id, other.id)),
		logAdminQuery(db, date, actorId, `moved the field "${field.name}" ${direction}`)
	]);
	return { ok: true };
}

export async function retireField(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<BuilderResult> {
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
): Promise<BuilderResult> {
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	if (field.type === 'choice' && !fieldOptions(field).length) {
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

/** Only a field that never collected a value can be deleted; one with
 * history retires instead. A recipe still reading it would break for
 * good, retired recipes included, since they can come back. */
export async function deleteField(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<BuilderResult> {
	if (ESSENTIAL.has(id)) {
		return { ok: false, reason: 'Height, weight and BMI are essential - they cannot be deleted.' };
	}
	const field = await fieldById(db, id);
	if (!field) return { ok: false, reason: 'No such field.' };
	if (await hasValues(db, id)) {
		return { ok: false, reason: 'This field has collected values - retire it instead.' };
	}
	const readers = recipesReading(await allFields(db), id).map((name) => `"${name}"`);
	if (readers.length) {
		const one = readers.length === 1;
		return {
			ok: false,
			reason: `The recipe${one ? '' : 's'} ${readers.join(', ')} still ${one ? 'reads' : 'read'} this field - change the recipe first, or retire this field instead.`
		};
	}
	await runBatch(db, [
		db.delete(table.fields).where(eq(table.fields.id, id)),
		logAdminQuery(db, date, actorId, `deleted the unused field "${field.name}"`)
	]);
	return { ok: true };
}

export async function addOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	optionRaw: string
): Promise<BuilderResult> {
	const option = cleanOption(optionRaw);
	if (!option) return { ok: false, reason: 'An option needs a name.' };
	const field = await choiceField(db, id);
	if (!field) return { ok: false, reason: 'No such choice field.' };
	const options = fieldOptions(field);
	if (options.includes(option)) return { ok: false, reason: 'That option already exists.' };
	await runBatch(db, [
		optionsQuery(db, id, [...options, option]),
		logAdminQuery(db, date, actorId, `added the option "${option}" to "${field.name}"`)
	]);
	return { ok: true };
}

/** Renaming an option rewrites every stored answer to the new spelling,
 * so history stays one filterable thing. */
export async function renameOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	from: string,
	toRaw: string
): Promise<BuilderResult> {
	const to = cleanOption(toRaw);
	if (!to) return { ok: false, reason: 'An option needs a name.' };
	const field = await choiceField(db, id);
	if (!field) return { ok: false, reason: 'No such choice field.' };
	const options = fieldOptions(field);
	if (!options.includes(from)) return { ok: false, reason: 'No such option.' };
	if (options.includes(to)) return { ok: false, reason: 'That option already exists.' };
	const statements: Writes = [
		optionsQuery(
			db,
			id,
			options.map((o) => (o === from ? to : o))
		),
		db
			.update(table.entryValues)
			.set({ choice: to })
			.where(and(eq(table.entryValues.fieldId, id), eq(table.entryValues.choice, from)))
	];
	// SQL equality cannot see inside a pick-several JSON list, so those
	// rows are rewritten one by one. A switched field holds both shapes.
	if (field.multiple) {
		const rows = await db.select().from(table.entryValues).where(eq(table.entryValues.fieldId, id));
		for (const row of rows) {
			const picks = choicePicks(row);
			if (!row.choice?.startsWith('[') || !picks.includes(from)) continue;
			statements.push(
				db
					.update(table.entryValues)
					.set({ choice: JSON.stringify(picks.map((p) => (p === from ? to : p))) })
					.where(and(eq(table.entryValues.entryId, row.entryId), eq(table.entryValues.fieldId, id)))
			);
		}
	}
	statements.push(
		logAdminQuery(db, date, actorId, `renamed the option "${from}" to "${to}" on "${field.name}"`)
	);
	await runBatch(db, statements);
	return { ok: true };
}

/** Removing an option only stops new picks. Members who carry it keep
 * it, and the charts keep counting it. */
export async function removeOption(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	option: string
): Promise<BuilderResult> {
	const field = await choiceField(db, id);
	if (!field) return { ok: false, reason: 'No such choice field.' };
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
