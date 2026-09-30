import type { Field } from '../db';
import type { TileView } from '$lib/views';
import { choicePicks } from '../fields';
import { round, valueIn, type Units } from '../units';
import { headlineText, signed } from './labels';
import type { LatestRow, WeekPoint } from './queries';
import { sparklinePoints } from './shapes';
import { MAX_WEEKS } from './focus';

/**
 * The board of tiles, one per field. Numbers get the group average and a
 * weekly sparkline; choices get their leaders by name. Built from two
 * bounded queries, so the board costs the same however long the history
 * grows. Trend lines only on `trendIds`; the rest of a tile stays.
 */
export function boardTiles(
	latest: LatestRow[],
	weekly: Map<string, WeekPoint[]>,
	fields: Field[],
	units: Units,
	trendIds: Set<string>
): TileView[] {
	return fields.map((field) => {
		const rows = latest.filter((row) => row.fieldId === field.id);
		if (field.type === 'number') {
			const numbers = rows.map((row) => valueIn(row, units)).filter((n): n is number => n != null);
			const series = (weekly.get(field.id) ?? [])
				.slice(-MAX_WEEKS)
				.map((p) => round(valueIn(p, units)!, 1));
			const avg = numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
			const drawn = series.length >= 2;
			return {
				id: field.id,
				name: field.name,
				poly: drawn && trendIds.has(field.id) ? sparklinePoints(series, 140, 36, 4) : null,
				bars: [],
				headline: avg == null ? '—' : headlineText(field, round(avg, 1), units),
				delta: drawn ? signed(series[series.length - 1] - series[0]) : null
			};
		}
		// Every pick counts, so a pick-several member can sit in several
		// bars. That is the honest shape of "pick several".
		const counts = new Map<string, number>();
		for (const row of rows) {
			for (const pick of choicePicks(row)) counts.set(pick, (counts.get(pick) ?? 0) + 1);
		}
		const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		const max = sorted[0]?.[1] ?? 0;
		return {
			id: field.id,
			name: field.name,
			poly: null,
			bars: sorted.slice(0, 4).map(([, c]) => Math.max(8, Math.round((c / max) * 100))),
			// Leaders by name, because bare counts say nothing without a tap.
			headline: sorted.length
				? sorted
						.slice(0, 3)
						.map(([label, c]) => `${label} ${c}`)
						.join(' · ')
				: '—',
			delta: null
		};
	});
}
