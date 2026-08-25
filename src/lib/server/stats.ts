/**
 * The core loop's arithmetic and storage: field parsing, unit
 * conversion, entries, corrections and their audit trail. The
 * conversion half is the part that can be wrong without looking wrong
 * (the old world's lesson), so it is pure and unit-tested by the e2e
 * loop end to end.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { FormFieldView } from '$lib/views';
import * as table from './db/schema';
import { randomToken } from './crypto';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export type Field = typeof table.fields.$inferSelect;
export type Entry = typeof table.entries.$inferSelect;
export type EntryValue = typeof table.entryValues.$inferSelect;
export type Units = 'imperial' | 'metric';

/* ---------------------------------------------------------------- */
/* Conversion - exact by definition, both constants                  */

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const IN_PER_FT = 12;

export function round(value: number, places: number): number {
	const factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
}

/** No stat in this binder reaches a million of anything, so nothing
 * above it is a value - it is a typo or an attack. The ceiling matters
 * beyond politeness: the histogram sizes itself from the range of the
 * stored values (charts.ts), so a cap on what can be typed is a cap on
 * what a chart can be made to build (fix pass 2026-08-25). */
export const NUMBER_MAX = 1_000_000;

/** A positive number, or null. Strict on purpose: Number('') is 0 and
 * parseFloat('5kg') is 5, and both would sail through as a value
 * nobody meant. A comma decimal is accepted because half the world
 * types one. `allowZero` exists for the inch box - a person who is
 * exactly 6 ft 0 in types a zero and means it (owner's drive,
 * 2026-08-24). Capped at NUMBER_MAX, so no caller can forget to. */
export function parseNumber(text: string, allowZero = false): number | null {
	const value = text.trim().replace(',', '.');
	if (value === '' || !/^\d*\.?\d+$/.test(value)) return null;
	const number = Number(value);
	if (!Number.isFinite(number) || number > NUMBER_MAX) return null;
	return number > 0 || (allowZero && number === 0) ? number : null;
}

/** feet/inches derived from the total so they cannot disagree with
 * it; the rounding carry (5 ft 11.98 in is not 5 ft 12 in) included. */
export function feetInches(totalInches: number): { feet: number; inches: number } {
	let feet = Math.floor(totalInches / IN_PER_FT);
	let inches = round(totalInches - feet * IN_PER_FT, 1);
	if (inches >= IN_PER_FT) {
		feet += 1;
		inches = 0;
	}
	return { feet, inches };
}

const fromLb = (lb: number) => ({ metric: round(lb * KG_PER_LB, 1), imperial: round(lb, 1) });
const fromKg = (kg: number) => ({ metric: round(kg, 1), imperial: round(kg / KG_PER_LB, 1) });
const fromInches = (t: number) => ({ metric: round(t * CM_PER_IN, 1), imperial: round(t, 1) });
const fromCm = (cm: number) => ({ metric: round(cm, 1), imperial: round(cm / CM_PER_IN, 1) });

/* ---------------------------------------------------------------- */
/* Formatting - what a person reads                                  */

/** The picks inside a stored choice value. A single-pick row holds
 * the option as plain text; a pick-several row holds a JSON list. A
 * field switched to pick-several keeps its old plain rows, so both
 * shapes must always read. */
export function choicePicks(value: EntryValue): string[] {
	const raw = value.choice;
	if (raw == null || raw === '') return [];
	if (raw.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			// A plain answer that happens to open with a bracket.
		}
	}
	return [raw];
}

export function formatValue(field: Field, value: EntryValue, units: Units): string {
	if (field.type === 'choice') return choicePicks(value).join(', ');
	const n = units === 'imperial' ? value.imperial : value.metric;
	if (n == null) return '';
	if (field.measure === 'length') {
		if (units === 'metric') return `${n} cm`;
		const { feet, inches } = feetInches(n);
		return `${feet} ft ${inches} in`;
	}
	if (field.measure === 'mass') return units === 'imperial' ? `${n} lb` : `${n} kg`;
	return String(n);
}

/** The site's calendar day. Entries are dated in one zone for the
 * whole group (default US Central); an admin setting can take this
 * over in the admin-surface feature. */
export function today(timezone: string | undefined): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone || 'America/Chicago'
	}).format(new Date());
}

export function formatDate(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/* ---------------------------------------------------------------- */
/* The form's fields                                                 */

export async function loadFields(db: Db): Promise<Field[]> {
	return db
		.select()
		.from(table.fields)
		.where(eq(table.fields.status, 'active'))
		.orderBy(asc(table.fields.position));
}

export function fieldOptions(field: Field): string[] {
	try {
		const parsed: unknown = JSON.parse(field.options ?? '[]');
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/* ---------------------------------------------------------------- */
/* The form as a person sees it                                      */

/** Each field turned into its input(s), pre-filled from the given
 * values in the member's units. Heights always render as feet and
 * inches in imperial - never a bare inch count. */
export function formFieldViews(
	fields: Field[],
	values: Record<string, EntryValue>,
	units: Units
): FormFieldView[] {
	const views: FormFieldView[] = [];
	const imperial = units === 'imperial';
	for (const field of fields) {
		const view: FormFieldView = {
			id: field.id,
			name: field.name,
			kind: 'single',
			options: [],
			ft: '',
			inches: '',
			single: '',
			choice: '',
			picks: [],
			unit: ''
		};
		const v = values[field.id];
		if (field.computed) {
			view.kind = 'computed';
		} else if (field.type === 'choice' && field.multiple) {
			view.kind = 'multi';
			view.options = fieldOptions(field);
			view.picks = v ? choicePicks(v) : [];
		} else if (field.type === 'choice') {
			view.kind = 'choice';
			view.options = fieldOptions(field);
			view.choice = v?.choice ?? '';
		} else if (field.measure === 'length' && imperial) {
			view.kind = 'length';
			if (v?.imperial != null) {
				const { feet, inches } = feetInches(v.imperial);
				view.ft = String(feet);
				view.inches = String(inches);
			}
		} else if (field.measure === 'length') {
			view.unit = 'cm';
			if (v?.metric != null) view.single = String(v.metric);
		} else if (field.measure === 'mass') {
			view.unit = imperial ? 'lb' : 'kg';
			const n = imperial ? v?.imperial : v?.metric;
			if (n != null) view.single = String(n);
		} else {
			if (v?.metric != null) view.single = String(v.metric);
		}
		views.push(view);
	}
	return views;
}

/* ---------------------------------------------------------------- */
/* Parsing a submitted form                                          */

export type ParsedValues = Record<
	string,
	{ metric: number | null; imperial: number | null; entered: string | null; choice: string | null }
>;

export type ParseResult = { values: ParsedValues; problems: string[] };

/**
 * Reads a submitted form against the field list. Every field is
 * optional; a filled one must parse. All problems come back at once -
 * a form that reveals one fault per attempt is three round trips for
 * someone who mistyped two things (the old world's lesson, kept).
 */
export function parseEntryForm(fields: Field[], form: FormData, units: Units): ParseResult {
	const values: ParsedValues = {};
	const problems: string[] = [];
	const imperial = units === 'imperial';

	for (const field of fields) {
		if (field.computed) continue;

		if (field.type === 'choice' && field.multiple) {
			// Checkboxes: every ticked box arrives as its own value. No
			// ticks parses as nothing here; carryForward decides whether
			// that silence means "none now" (owner ruling 2026-08-24).
			const ticked = form
				.getAll(`f_${field.id}`)
				.filter((v): v is string => typeof v === 'string')
				.map((v) => v.trim())
				.filter(Boolean);
			if (!ticked.length) continue;
			const options = fieldOptions(field);
			if (ticked.some((t) => !options.includes(t))) {
				problems.push(`${field.name}: that is not one of the choices.`);
				continue;
			}
			// Stored in the options' order, deduplicated - the answer is a
			// set, and it should read the same however the boxes were hit.
			const picks = options.filter((o) => ticked.includes(o));
			values[field.id] = {
				metric: null,
				imperial: null,
				entered: null,
				choice: JSON.stringify(picks)
			};
			continue;
		}

		if (field.type === 'choice') {
			const raw = String(form.get(`f_${field.id}`) ?? '').trim();
			if (!raw) continue;
			if (!fieldOptions(field).includes(raw)) {
				problems.push(`${field.name}: that is not one of the choices.`);
				continue;
			}
			values[field.id] = { metric: null, imperial: null, entered: null, choice: raw };
			continue;
		}

		if (field.measure === 'length' && imperial) {
			const ftRaw = String(form.get(`f_${field.id}_ft`) ?? '').trim();
			const inRaw = String(form.get(`f_${field.id}_in`) ?? '').trim();
			if (!ftRaw && !inRaw) continue;
			// Either box may be zero; the TOTAL must be above zero.
			const feet = ftRaw ? parseNumber(ftRaw, true) : 0;
			const inches = inRaw ? parseNumber(inRaw, true) : 0;
			if (feet === null || inches === null) {
				problems.push(`${field.name}: enter feet and inches as numbers, below a million.`);
				continue;
			}
			const total = feet * IN_PER_FT + inches;
			if (total <= 0) continue;
			// Each box is capped, but twelve inches to the foot means the
			// TOTAL can still clear the ceiling. Same rule, same answer.
			if (total > NUMBER_MAX) {
				problems.push(`${field.name}: that is too large to be real.`);
				continue;
			}
			values[field.id] = {
				...fromInches(total),
				entered: `${ftRaw || '0'} ft ${inRaw || '0'} in`,
				choice: null
			};
			continue;
		}

		const raw = String(form.get(`f_${field.id}`) ?? '').trim();
		if (!raw) continue;
		const n = parseNumber(raw);
		if (n === null) {
			problems.push(`${field.name}: enter a number above zero, below a million.`);
			continue;
		}
		if (field.measure === 'length') {
			values[field.id] = { ...fromCm(n), entered: `${raw} cm`, choice: null };
		} else if (field.measure === 'mass') {
			values[field.id] = imperial
				? { ...fromLb(n), entered: `${raw} lb`, choice: null }
				: { ...fromKg(n), entered: `${raw} kg`, choice: null };
		} else {
			values[field.id] = { metric: n, imperial: n, entered: raw, choice: null };
		}
	}

	return { values, problems };
}

/**
 * A blank field on a NEW entry keeps its last value (owner ruling
 * 2026-08-24): nobody re-enters what they already told the binder.
 * Editing an entry is the opposite - there, clearing a field really
 * removes it, because edit is the precision tool.
 */
export function carryForward(
	fields: Field[],
	values: ParsedValues,
	latest: Record<string, EntryValue>
): void {
	for (const field of fields) {
		if (field.computed || values[field.id]) continue;
		const prior = latest[field.id];
		if (!prior) continue;
		if (field.type === 'choice' && field.multiple) {
			// The checkboxes arrive pre-checked with the latest picks, so
			// the pre-fill IS the carry - no ticks in the submit means the
			// member deliberately cleared them. That records "none now"
			// (owner ruling 2026-08-24) instead of quietly restoring picks
			// they just removed.
			if (choicePicks(prior).length) {
				values[field.id] = { metric: null, imperial: null, entered: null, choice: '[]' };
			}
			continue;
		}
		values[field.id] = {
			metric: prior.metric,
			imperial: prior.imperial,
			entered: prior.entered,
			choice: prior.choice
		};
	}
}

/**
 * BMI = kg / m^2, computed from this entry's height and weight (by
 * their seeded ids). If either is missing or its field is gone, BMI
 * quietly sits out - retiring a field must never break saving.
 */
export function computeBmi(fields: Field[], values: ParsedValues): void {
	const bmiField = fields.find((f) => f.computed === 'bmi');
	if (!bmiField) return;
	const heightCm = values['height']?.metric;
	const weightKg = values['weight']?.metric;
	if (!heightCm || !weightKg) return;
	const meters = heightCm / 100;
	const bmi = round(weightKg / (meters * meters), 1);
	values[bmiField.id] = { metric: bmi, imperial: bmi, entered: null, choice: null };
}

/* ---------------------------------------------------------------- */
/* Entries                                                           */

export async function createEntry(
	db: Db,
	memberId: string,
	date: string,
	values: ParsedValues
): Promise<string> {
	const id = randomToken(16);
	const [{ maxSeq }] = await db
		.select({ maxSeq: sql<number>`coalesce(max(${table.entries.seq}), 0)` })
		.from(table.entries)
		.where(eq(table.entries.memberId, memberId));
	await db.insert(table.entries).values({ id, memberId, date, seq: maxSeq + 1 });
	const rows = Object.entries(values).map(([fieldId, v]) => ({ entryId: id, fieldId, ...v }));
	if (rows.length) await db.insert(table.entryValues).values(rows);
	return id;
}

export async function memberEntry(db: Db, memberId: string, entryId: string) {
	const entry = (
		await db
			.select()
			.from(table.entries)
			.where(and(eq(table.entries.id, entryId), eq(table.entries.memberId, memberId)))
	)[0];
	if (!entry) return null;
	const values = await db
		.select()
		.from(table.entryValues)
		.where(eq(table.entryValues.entryId, entryId));
	return { entry, values };
}

async function auditRow(
	db: Db,
	memberId: string,
	action: 'edit' | 'delete',
	entry: Entry,
	values: EntryValue[],
	auditDate: string
) {
	await db.insert(table.memberAudit).values({
		id: randomToken(16),
		memberId,
		date: auditDate,
		action,
		entryId: entry.id,
		entryDate: entry.date,
		before: JSON.stringify(
			Object.fromEntries(
				values.map((v) => [
					v.fieldId,
					{ metric: v.metric, imperial: v.imperial, entered: v.entered, choice: v.choice }
				])
			)
		)
	});
}

/** Replace an entry's values (the date stays - corrections change
 * numbers, not history's shape), with the before-image kept for admin
 * review. Returns false when the entry is not this member's. */
export async function editEntry(
	db: Db,
	memberId: string,
	entryId: string,
	values: ParsedValues,
	auditDate: string
): Promise<boolean> {
	const found = await memberEntry(db, memberId, entryId);
	if (!found) return false;
	await auditRow(db, memberId, 'edit', found.entry, found.values, auditDate);
	await db.delete(table.entryValues).where(eq(table.entryValues.entryId, entryId));
	const rows = Object.entries(values).map(([fieldId, v]) => ({ entryId, fieldId, ...v }));
	if (rows.length) await db.insert(table.entryValues).values(rows);
	return true;
}

export async function deleteEntry(
	db: Db,
	memberId: string,
	entryId: string,
	auditDate: string
): Promise<boolean> {
	const found = await memberEntry(db, memberId, entryId);
	if (!found) return false;
	await auditRow(db, memberId, 'delete', found.entry, found.values, auditDate);
	await db.delete(table.entryValues).where(eq(table.entryValues.entryId, entryId));
	await db.delete(table.entries).where(eq(table.entries.id, entryId));
	return true;
}

/* ---------------------------------------------------------------- */
/* Reading a member's history                                        */

export type HistoryEntry = { entry: Entry; values: EntryValue[] };

/** Newest first. `limit + 1` rows are fetched so the caller knows an
 * older page exists without a count query. */
export async function memberHistory(
	db: Db,
	memberId: string,
	page: number,
	pageSize: number
): Promise<{ entries: HistoryEntry[]; hasOlder: boolean }> {
	const rows = await db
		.select()
		.from(table.entries)
		.where(eq(table.entries.memberId, memberId))
		.orderBy(desc(table.entries.date), desc(table.entries.seq))
		.limit(pageSize + 1)
		.offset((page - 1) * pageSize);
	const hasOlder = rows.length > pageSize;
	const entries = rows.slice(0, pageSize);
	if (!entries.length) return { entries: [], hasOlder };
	const values = await db
		.select()
		.from(table.entryValues)
		.where(
			inArray(
				table.entryValues.entryId,
				entries.map((e) => e.id)
			)
		);
	return {
		entries: entries.map((entry) => ({
			entry,
			values: values.filter((v) => v.entryId === entry.id)
		})),
		hasOlder
	};
}

/** The member's latest value per field, for pre-filling the form -
 * stable facts like height and country should already be there. */
export async function latestValues(db: Db, memberId: string): Promise<Record<string, EntryValue>> {
	const rows = await db
		.select({ value: table.entryValues, date: table.entries.date, seq: table.entries.seq })
		.from(table.entryValues)
		.innerJoin(table.entries, eq(table.entryValues.entryId, table.entries.id))
		.where(eq(table.entries.memberId, memberId))
		.orderBy(asc(table.entries.date), asc(table.entries.seq));
	const latest: Record<string, EntryValue> = {};
	for (const row of rows) latest[row.value.fieldId] = row.value;
	return latest;
}

/* ---------------------------------------------------------------- */
/* Trends - the small lines on your page                             */

export type Trend = { field: Field; points: number[]; latest: string };

/** One trend per numeric field with at least two values, oldest to
 * newest, capped at the last 60 points, in the member's units. */
export async function memberTrends(
	db: Db,
	fields: Field[],
	memberId: string,
	units: Units
): Promise<Trend[]> {
	const rows = await db
		.select({ value: table.entryValues })
		.from(table.entryValues)
		.innerJoin(table.entries, eq(table.entryValues.entryId, table.entries.id))
		.where(eq(table.entries.memberId, memberId))
		.orderBy(asc(table.entries.date), asc(table.entries.seq));
	const trends: Trend[] = [];
	for (const field of fields) {
		if (field.type !== 'number') continue;
		const points = rows
			.filter((r) => r.value.fieldId === field.id)
			.map((r) => (units === 'imperial' ? r.value.imperial : r.value.metric))
			.filter((n): n is number => n != null)
			.slice(-60);
		if (points.length < 2) continue;
		const latestValue = rows.filter((r) => r.value.fieldId === field.id).at(-1)!.value;
		trends.push({ field, points, latest: formatValue(field, latestValue, units) });
	}
	return trends;
}

/** Points scaled into an SVG polyline, drawn server-side - the page
 * ships no JavaScript. A flat line sits in the middle on purpose. */
export function sparklinePoints(points: number[], width = 200, height = 44, pad = 4): string {
	const min = Math.min(...points);
	const max = Math.max(...points);
	const span = max - min;
	const step = (width - pad * 2) / (points.length - 1);
	return points
		.map((p, i) => {
			const x = pad + i * step;
			const y = span === 0 ? height / 2 : height - pad - ((p - min) / span) * (height - pad * 2);
			return `${round(x, 1)},${round(y, 1)}`;
		})
		.join(' ');
}
