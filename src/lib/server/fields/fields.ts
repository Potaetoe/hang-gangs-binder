import { asc, eq } from 'drizzle-orm';
import type { Db, EntryValue, Field } from '../db';
import * as table from '../db/schema';
import { feetInches, valueIn, type Units } from '../units';
import { formulaUnit } from './calc';

/** Height, weight and BMI hold the site together: renameable, never
 * retired or deleted. */
export const ESSENTIAL = new Set(['height', 'weight', 'bmi']);

/** The fields on the form, in form order. */
export async function loadFields(db: Db): Promise<Field[]> {
	return db
		.select()
		.from(table.fields)
		.where(eq(table.fields.status, 'active'))
		.orderBy(asc(table.fields.position));
}

/** Retired ones too, for the admin's form builder. */
export async function allFields(db: Db): Promise<Field[]> {
	return db.select().from(table.fields).orderBy(asc(table.fields.position));
}

export async function fieldById(db: Db, id: string): Promise<Field | undefined> {
	const [field] = await db.select().from(table.fields).where(eq(table.fields.id, id));
	return field;
}

/** Whether any entry ever stored a value for this field. */
export async function hasValues(db: Db, fieldId: string): Promise<boolean> {
	const [row] = await db
		.select({ fieldId: table.entryValues.fieldId })
		.from(table.entryValues)
		.where(eq(table.entryValues.fieldId, fieldId))
		.limit(1);
	return Boolean(row);
}

export function fieldOptions(field: Field): string[] {
	try {
		const parsed: unknown = JSON.parse(field.options ?? '[]');
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/** The picks in a stored choice. A single pick is plain text and a
 * pick-several answer is a JSON list; a field switched to pick-several
 * keeps its old plain rows, so both shapes must read. */
export function choicePicks(value: Pick<EntryValue, 'choice'>): string[] {
	const raw = value.choice;
	if (raw == null || raw === '') return [];
	if (raw.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			// A plain answer that happens to start with a bracket.
		}
	}
	return [raw];
}

/** A stored value as a person reads it. */
export function formatValue(field: Field, value: EntryValue, units: Units): string {
	if (field.type === 'choice') return choicePicks(value).join(', ');
	const n = valueIn(value, units);
	if (n == null) return '';
	if (field.measure === 'length') {
		if (units === 'metric') return `${n} cm`;
		const { feet, inches } = feetInches(n);
		return `${feet} ft ${inches} in`;
	}
	if (field.measure === 'mass') return units === 'imperial' ? `${n} lb` : `${n} kg`;
	const unit = formulaUnit(field);
	return unit ? `${n} ${unit}` : String(n);
}
