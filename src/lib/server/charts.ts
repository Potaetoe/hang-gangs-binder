/**
 * The group's charts (DESIGN.md "Core loop"; owner rulings
 * 2026-08-24): the board of tiles, the focused field with filters,
 * weekly trends, and automatic distributions. Everything is derived
 * from the field rows, so a field an admin adds charts itself -
 * numbers get trend + distribution, choices get counts and become
 * filters. No floor: the owner ruled charts show whatever matches,
 * however few (recorded in DESIGN.md the same day).
 */

import { asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { FocusView, TileView } from '$lib/views';
import * as table from './db/schema';
import {
	choicePicks,
	feetInches,
	fieldOptions,
	round,
	sparklinePoints,
	type EntryValue,
	type Field,
	type Units
} from './stats';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

/** fieldId -> required choice values. Built from ?f_<fieldId>= params;
 * pick-several fields may require several at once (owner ruling
 * 2026-08-24: a member matches only when their picks include ALL of
 * them). */
export type Filters = Record<string, string[]>;

type GroupEntry = { date: string; seq: number; values: Map<string, EntryValue> };
/** memberId -> entries, oldest first. */
export type Group = Map<string, GroupEntry[]>;

export async function loadGroup(db: Db): Promise<Group> {
	const rows = await db
		.select({ entry: table.entries, value: table.entryValues })
		.from(table.entries)
		.leftJoin(table.entryValues, eq(table.entryValues.entryId, table.entries.id))
		.orderBy(asc(table.entries.date), asc(table.entries.seq));
	const group: Group = new Map();
	const byEntry = new Map<string, GroupEntry>();
	for (const row of rows) {
		let entry = byEntry.get(row.entry.id);
		if (!entry) {
			entry = { date: row.entry.date, seq: row.entry.seq, values: new Map() };
			byEntry.set(row.entry.id, entry);
			const list = group.get(row.entry.memberId) ?? [];
			list.push(entry);
			group.set(row.entry.memberId, list);
		}
		if (row.value) entry.values.set(row.value.fieldId, row.value);
	}
	return group;
}

/** Reads ?f_<choiceFieldId>=<option> params into filters, ignoring
 * anything that is not a real option of a real choice field. A
 * repeated param (pick-several checkboxes) collects every value. */
export function readFilters(fields: Field[], params: URLSearchParams): Filters {
	const filters: Filters = {};
	for (const field of fields) {
		if (field.type !== 'choice') continue;
		const options = fieldOptions(field);
		const wanted = [...new Set(params.getAll(`f_${field.id}`))].filter((v) => options.includes(v));
		if (wanted.length) filters[field.id] = wanted;
	}
	return filters;
}

/** Every filter value must be among the entry's picks. A single-pick
 * answer is a one-item pick-set, so one rule covers both shapes. */
const matches = (entry: GroupEntry, filters: Filters): boolean =>
	Object.entries(filters).every(([fieldId, wanted]) => {
		const value = entry.values.get(fieldId);
		if (!value) return false;
		const picks = choicePicks(value);
		return wanted.every((w) => picks.includes(w));
	});

/** The member's newest entry that matches the filters and carries the
 * field, or null. "Latest" is per field on purpose - an entry that
 * skipped weight does not erase the weight before it. */
function latestValue(entries: GroupEntry[], fieldId: string, filters: Filters): EntryValue | null {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		if (!matches(entries[i], filters)) continue;
		const value = entries[i].values.get(fieldId);
		if (value) return value;
	}
	return null;
}

const numberOf = (value: EntryValue, units: Units): number | null =>
	units === 'imperial' ? value.imperial : value.metric;

/* ---------------------------------------------------------------- */
/* Weeks                                                             */

const DAY = 86_400_000;
const weekOf = (date: string): number =>
	Math.floor(Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY) / 7);

const weekLabel = (week: number): string =>
	new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
		new Date(week * 7 * DAY)
	);

const MAX_WEEKS = 26;

/** Weekly group averages: each member counts once per week - their
 * last matching entry of that week (owner ruling: trend goes by
 * weekly entries). Only weeks with data appear. */
export function weeklySeries(
	group: Group,
	fieldId: string,
	filters: Filters,
	units: Units
): { week: number; avg: number }[] {
	const perWeek = new Map<number, number[]>();
	for (const entries of group.values()) {
		const byWeek = new Map<number, number>();
		for (const entry of entries) {
			if (!matches(entry, filters)) continue;
			const value = entry.values.get(fieldId);
			const n = value ? numberOf(value, units) : null;
			if (n != null) byWeek.set(weekOf(entry.date), n);
		}
		for (const [week, n] of byWeek) {
			const list = perWeek.get(week) ?? [];
			list.push(n);
			perWeek.set(week, list);
		}
	}
	return [...perWeek.entries()]
		.sort((a, b) => a[0] - b[0])
		.slice(-MAX_WEEKS)
		.map(([week, ns]) => ({ week, avg: round(ns.reduce((a, b) => a + b, 0) / ns.length, 1) }));
}

/* ---------------------------------------------------------------- */
/* Formatting                                                        */

/** Compact axis text: heights read as 5'10", nothing else is odd. */
function axisText(field: Field, n: number, units: Units): string {
	if (field.measure === 'length' && units === 'imperial') {
		const { feet, inches } = feetInches(n);
		return `${feet}'${round(inches, 0)}"`;
	}
	return String(round(n, 1));
}

/** "200–220 lb", "5'6\"–5'8\"", "30–35" - a bucket's range,
 * readable at 18. */
function rangeLabel(field: Field, from: number, to: number, units: Units): string {
	const suffix =
		field.measure === 'mass'
			? units === 'imperial'
				? ' lb'
				: ' kg'
			: field.measure === 'length' && units === 'metric'
				? ' cm'
				: '';
	return `${axisText(field, from, units)}–${axisText(field, to, units)}${suffix}`;
}

const unitSuffix = (field: Field, units: Units): string => {
	if (field.measure === 'mass') return units === 'imperial' ? ' lb' : ' kg';
	if (field.measure === 'length') return units === 'imperial' ? ' in' : ' cm';
	return '';
};

/** "238 lb", "5 ft 11 in", "31.9" - a group average, readably. */
function headlineText(field: Field, n: number, units: Units): string {
	if (field.measure === 'length' && units === 'imperial') {
		const { feet, inches } = feetInches(n);
		return `${feet} ft ${inches} in`;
	}
	return `${round(n, 1)}${unitSuffix(field, units)}`;
}

const signed = (n: number): string => (n >= 0 ? `+${round(n, 1)}` : String(round(n, 1)));

/* ---------------------------------------------------------------- */
/* Buckets - automatic, snapped to round steps                       */

function niceStep(raw: number): number {
	const power = Math.pow(10, Math.floor(Math.log10(raw)));
	for (const mult of [1, 2, 5, 10]) {
		if (mult * power >= raw) return mult * power;
	}
	return 10 * power;
}

/** The old world's ruling, kept (owner, 2026-08-24): matched widths
 * per measure, so flipping units never reshapes the histogram -
 * 20 lb is about 10 kg, 2 in is about 5 cm, BMI bins by 5. Fields
 * with no known scale fall back to automatic round steps. */
export function bucketWidth(field: Field, units: Units): number | null {
	if (field.measure === 'mass') return units === 'imperial' ? 20 : 10;
	if (field.measure === 'length') return units === 'imperial' ? 2 : 5;
	if (field.computed === 'bmi') return 5;
	return null;
}

/** The histogram never draws more bars than this. The matched widths
 * above hold for every real spread of twenty people; the cap exists
 * because the bar count is derived from the range of the data, and one
 * absurd stored value must not decide how much the page allocates and
 * renders (fix pass 2026-08-25). Entry parsing caps what can be typed
 * (stats.ts NUMBER_MAX); this holds even against a value that got in
 * anyway. */
const MAX_BUCKETS = 60;

export function buckets(
	values: number[],
	width: number | null = null,
	target = 7
): { start: number; step: number; counts: number[] } | null {
	if (!values.length) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	let step = width ?? (min === max ? 1 : niceStep((max - min) / target));
	// Doubling keeps the steps round (20 lb, 40 lb, 80 lb...).
	while ((max - min) / step >= MAX_BUCKETS) step *= 2;
	const start = Math.floor(min / step) * step;
	const count = Math.max(1, Math.floor((max - start) / step) + 1);
	const counts = new Array(count).fill(0) as number[];
	for (const v of values) {
		counts[Math.min(count - 1, Math.floor((v - start) / step))] += 1;
	}
	return { start, step, counts };
}

/* ---------------------------------------------------------------- */
/* The board                                                         */

const memberCount = (group: Group): number => group.size;

export function boardTiles(group: Group, fields: Field[], units: Units): TileView[] {
	const tiles: TileView[] = [];
	for (const field of fields) {
		if (field.type === 'number') {
			const latest: number[] = [];
			for (const entries of group.values()) {
				const value = latestValue(entries, field.id, {});
				const n = value ? numberOf(value, units) : null;
				if (n != null) latest.push(n);
			}
			const series = weeklySeries(group, field.id, {}, units);
			const avg = latest.length ? latest.reduce((a, b) => a + b, 0) / latest.length : null;
			tiles.push({
				id: field.id,
				name: field.name,
				poly:
					series.length >= 2
						? sparklinePoints(
								series.map((p) => p.avg),
								140,
								36,
								4
							)
						: null,
				bars: [],
				headline: avg == null ? '—' : headlineText(field, round(avg, 1), units),
				delta: series.length >= 2 ? signed(series[series.length - 1].avg - series[0].avg) : null
			});
		} else {
			// Every pick counts, so a pick-several member can sit in
			// several bars - that is the honest shape of "pick several".
			const counts = new Map<string, number>();
			for (const entries of group.values()) {
				const value = latestValue(entries, field.id, {});
				if (!value) continue;
				for (const pick of choicePicks(value)) counts.set(pick, (counts.get(pick) ?? 0) + 1);
			}
			const sorted = [...counts.values()].sort((a, b) => b - a);
			const top = sorted.slice(0, 4);
			const max = top[0] ?? 0;
			tiles.push({
				id: field.id,
				name: field.name,
				poly: null,
				bars: top.map((c) => Math.max(8, Math.round((c / max) * 100))),
				headline:
					sorted.length === 0
						? '—'
						: sorted.length <= 3
							? sorted.join(' · ')
							: `${sorted.length} answers`,
				delta: null
			});
		}
	}
	return tiles;
}

/* ---------------------------------------------------------------- */
/* The focused field                                                 */

const TREND_W = 600;
const TREND_H = 220;
const TREND_PAD = 14;
const AXIS_GUTTER = 40;

function trendPoly(series: number[], min: number, max: number): string {
	const span = max - min;
	const innerW = TREND_W - AXIS_GUTTER - TREND_PAD;
	const step = series.length > 1 ? innerW / (series.length - 1) : 0;
	return series
		.map((v, i) => {
			const x = AXIS_GUTTER + i * step;
			const y =
				span === 0
					? TREND_H / 2
					: TREND_H - TREND_PAD - ((v - min) / span) * (TREND_H - TREND_PAD * 2);
			return `${round(x, 1)},${round(y, 1)}`;
		})
		.join(' ');
}

export function focusView(
	group: Group,
	fields: Field[],
	field: Field,
	filters: Filters,
	units: Units,
	viewerId: string
): FocusView {
	const filtered = Object.keys(filters).length > 0;
	const total = memberCount(group);

	// Latest value per member under the filters. For choices, every
	// pick counts - but a member counts once as a respondent, even one
	// whose latest answer is "none" (an empty pick-set).
	const latest: number[] = [];
	const latestChoices = new Map<string, number>();
	let respondents = 0;
	for (const entries of group.values()) {
		const value = latestValue(entries, field.id, filters);
		if (!value) continue;
		if (field.type === 'number') {
			const n = numberOf(value, units);
			if (n != null) latest.push(n);
		} else {
			respondents += 1;
			for (const pick of choicePicks(value)) {
				latestChoices.set(pick, (latestChoices.get(pick) ?? 0) + 1);
			}
		}
	}
	const matchCount = field.type === 'number' ? latest.length : respondents;

	// Filters panel: every OTHER choice field.
	const filterFields = fields
		.filter((f) => f.type === 'choice' && f.id !== field.id)
		.map((f) => ({
			id: f.id,
			name: f.name,
			options: fieldOptions(f),
			multiple: f.multiple,
			selected: filters[f.id] ?? []
		}));

	const view: FocusView = {
		name: field.name,
		isChoice: field.type === 'choice',
		stats: [{ label: 'match', value: `${matchCount} of ${total}`, accent: false }],
		trend: null,
		dist: null,
		counts: [],
		filterFields,
		empty: null
	};

	if (matchCount === 0) {
		view.empty = filtered
			? 'Nobody matches those filters yet.'
			: 'No entries carry this field yet.';
		return view;
	}

	if (field.type === 'choice') {
		const sorted = [...latestChoices.entries()].sort((a, b) => b[1] - a[1]);
		// Everyone matching can have answered "none" on a pick-several
		// field: respondents without a single bar to draw.
		if (!sorted.length) return view;
		const max = sorted[0][1];
		view.counts = sorted.map(([label, count]) => ({
			label,
			count,
			pct: Math.max(4, Math.round((count / max) * 100))
		}));
		return view;
	}

	const avg = latest.reduce((a, b) => a + b, 0) / latest.length;
	view.stats.push({
		label: filtered ? 'their avg' : 'group avg',
		value: headlineText(field, round(avg, 1), units),
		accent: false
	});

	// Trend: the filtered line, with the whole group as a ghost when
	// filters are on.
	const series = weeklySeries(group, field.id, filters, units);
	const ghost = filtered ? weeklySeries(group, field.id, {}, units) : [];
	if (series.length >= 2) {
		const all = [...series.map((p) => p.avg), ...ghost.map((p) => p.avg)];
		const min = Math.min(...all);
		const max = Math.max(...all);
		view.trend = {
			poly: trendPoly(
				series.map((p) => p.avg),
				min,
				max
			),
			ghost:
				ghost.length >= 2
					? trendPoly(
							ghost.map((p) => p.avg),
							min,
							max
						)
					: null,
			yMax: axisText(field, max, units),
			yMid: axisText(field, (min + max) / 2, units),
			yMin: axisText(field, min, units),
			xFirst: weekLabel(series[0].week),
			xLast: weekLabel(series[series.length - 1].week)
		};
		const delta = series[series.length - 1].avg - series[0].avg;
		view.stats.push({
			label: `${series.length} weeks`,
			value: `${signed(delta)}${unitSuffix(field, units)}`,
			accent: true
		});
	}

	// Distribution of the latest values, with the viewer's own bucket
	// lit ("you are here") - but only when the viewer is IN the
	// filtered view. Outside the filters, nothing shows (owner's
	// drive, 2026-08-24).
	const b = buckets(latest, bucketWidth(field, units));
	if (b) {
		const viewerValue = latestValue(group.get(viewerId) ?? [], field.id, filters);
		const you = viewerValue ? numberOf(viewerValue, units) : null;
		const youBucket =
			you == null ? -1 : Math.min(b.counts.length - 1, Math.floor((you - b.start) / b.step));
		const maxCount = Math.max(...b.counts);
		view.dist = {
			bars: b.counts.map((c, i) => ({
				pct: Math.max(c === 0 ? 2 : 8, Math.round((c / maxCount) * 100)),
				on: i === youBucket,
				label: `${rangeLabel(field, b.start + i * b.step, b.start + (i + 1) * b.step, units)} · ${c} ${c === 1 ? 'member' : 'members'}`
			})),
			from: axisText(field, b.start, units),
			to: axisText(field, b.start + b.step * b.counts.length, units),
			you: you == null ? null : `you are here: ${headlineText(field, you, units)}`
		};
	}

	return view;
}
