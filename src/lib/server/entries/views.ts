import type { Db, Field } from '../db';
import type { EntryTableView, TrendView } from '$lib/views';
import { formatDay } from '../days';
import { formatValue } from '../fields';
import { valueIn, type Units } from '../units';
import { sparklinePoints } from '../charts';
import { valuesOldestFirst, type HistoryEntry } from './store';

/** One column per field, so a row reads like the form that made it. */
export function entryTable(fields: Field[], entries: HistoryEntry[], units: Units): EntryTableView {
	return {
		columns: fields.map((f) => f.name),
		rows: entries.map(({ entry, values }) => ({
			id: entry.id,
			dateLabel: formatDay(entry.date),
			cells: fields.map((field) => {
				const value = values.find((v) => v.fieldId === field.id);
				return value ? formatValue(field, value, units) : '';
			})
		}))
	};
}

/** The last 60 points of each number field with at least two values,
 * oldest to newest, in the member's units. */
export async function memberTrends(
	db: Db,
	fields: Field[],
	memberId: string,
	units: Units
): Promise<TrendView[]> {
	const rows = await valuesOldestFirst(db, memberId);
	const trends: TrendView[] = [];
	for (const field of fields) {
		if (field.type !== 'number') continue;
		const values = rows.filter((r) => r.value.fieldId === field.id).map((r) => r.value);
		const points = values
			.map((v) => valueIn(v, units))
			.filter((n): n is number => n != null)
			.slice(-60);
		if (points.length < 2) continue;
		trends.push({
			name: field.name,
			poly: sparklinePoints(points),
			latest: formatValue(field, values.at(-1)!, units)
		});
	}
	return trends;
}
