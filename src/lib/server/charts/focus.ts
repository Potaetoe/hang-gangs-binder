import type { EntryValue, Field } from '../db';
import type { FocusView } from '$lib/views';
import { choicePicks, fieldOptions } from '../fields';
import { round, valueIn, type Units } from '../units';
import { axisText, headlineText, rangeLabel, signed, unitSuffix } from './labels';
import type { Group, GroupEntry } from './queries';
import { bucketWidth, buckets, trendPoly } from './shapes';

/** fieldId -> the options a member's picks must all include. */
export type Filters = Record<string, string[]>;

export const MAX_WEEKS = 26;
const DAY_MS = 86_400_000;

const weekOf = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS / 7);

const weekLabel = (week: number): string =>
	new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
		new Date(week * 7 * DAY_MS)
	);

/** Reads ?f_<fieldId>= params, keeping only real options of real choice
 * fields. A repeated param (pick-several) collects every value. */
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

/** Every wanted option must be among the entry's picks. A single answer
 * is a one-item set, so one rule covers both kinds of choice. */
const matches = (entry: GroupEntry, filters: Filters): boolean =>
	Object.entries(filters).every(([fieldId, wanted]) => {
		const value = entry.values.get(fieldId);
		return value !== undefined && wanted.every((w) => choicePicks(value).includes(w));
	});

/** The member's newest matching value of a field. Per field on purpose:
 * an entry that skipped weight does not erase the weight before it. */
function latestValue(entries: GroupEntry[], fieldId: string, filters: Filters): EntryValue | null {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		if (!matches(entries[i], filters)) continue;
		const value = entries[i].values.get(fieldId);
		if (value) return value;
	}
	return null;
}

/** Weekly averages where each member counts once a week, by their last
 * matching value that week. Only weeks with data appear. */
function weeklySeries(group: Group, fieldId: string, filters: Filters, units: Units) {
	const perWeek = new Map<number, number[]>();
	for (const entries of group.values()) {
		const byWeek = new Map<number, number>();
		for (const entry of entries) {
			if (!matches(entry, filters)) continue;
			const n = valueIn(entry.values.get(fieldId), units);
			if (n != null) byWeek.set(weekOf(entry.date), n);
		}
		for (const [week, n] of byWeek) perWeek.set(week, [...(perWeek.get(week) ?? []), n]);
	}
	return [...perWeek.entries()]
		.sort((a, b) => a[0] - b[0])
		.slice(-MAX_WEEKS)
		.map(([week, ns]) => ({ week, avg: round(ns.reduce((a, b) => a + b, 0) / ns.length, 1) }));
}

/**
 * One field in depth: who matches, the average, the weekly trend with
 * the whole group as a ghost line when filtered, and where everyone
 * sits. No floor: it shows whatever matches, however few (DESIGN.md).
 * `total` comes from the database, since `group` holds only the fields
 * this view reads.
 */
export function focusView(
	group: Group,
	fields: Field[],
	field: Field,
	filters: Filters,
	units: Units,
	viewerId: string,
	total: number,
	showTrend: boolean
): FocusView {
	const filtered = Object.keys(filters).length > 0;

	// A member counts once as a respondent even when their latest answer
	// is an empty pick-set, but each of their picks counts in the bars.
	const numbers: number[] = [];
	const picks = new Map<string, number>();
	let respondents = 0;
	for (const entries of group.values()) {
		const value = latestValue(entries, field.id, filters);
		if (!value) continue;
		if (field.type === 'number') {
			const n = valueIn(value, units);
			if (n != null) numbers.push(n);
		} else {
			respondents += 1;
			for (const pick of choicePicks(value)) picks.set(pick, (picks.get(pick) ?? 0) + 1);
		}
	}
	const matchCount = field.type === 'number' ? numbers.length : respondents;

	const view: FocusView = {
		name: field.name,
		isChoice: field.type === 'choice',
		stats: [{ label: 'match', value: `${matchCount} of ${total}`, accent: false }],
		trend: null,
		dist: null,
		counts: [],
		filterFields: fields
			.filter((f) => f.type === 'choice' && f.id !== field.id)
			.map((f) => ({
				id: f.id,
				name: f.name,
				options: fieldOptions(f),
				multiple: f.multiple,
				selected: filters[f.id] ?? []
			})),
		empty: null
	};

	if (matchCount === 0) {
		view.empty = filtered
			? 'Nobody matches those filters yet.'
			: 'No entries carry this field yet.';
		return view;
	}

	if (field.type === 'choice') {
		const sorted = [...picks.entries()].sort((a, b) => b[1] - a[1]);
		const max = sorted[0]?.[1] ?? 0;
		view.counts = sorted.map(([label, count]) => ({
			label,
			count,
			pct: Math.max(4, Math.round((count / max) * 100))
		}));
		return view;
	}

	const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
	view.stats.push({
		label: filtered ? 'their avg' : 'group avg',
		value: headlineText(field, round(avg, 1), units),
		accent: false
	});

	const series = weeklySeries(group, field.id, filters, units);
	if (series.length >= 2) {
		const ghost = filtered ? weeklySeries(group, field.id, {}, units) : [];
		const all = [...series, ...ghost].map((p) => p.avg);
		const min = Math.min(...all);
		const max = Math.max(...all);
		const line = (points: { avg: number }[]) =>
			trendPoly(
				points.map((p) => p.avg),
				min,
				max
			);
		if (showTrend) {
			view.trend = {
				poly: line(series),
				ghost: ghost.length >= 2 ? line(ghost) : null,
				yMax: axisText(field, max, units),
				yMid: axisText(field, (min + max) / 2, units),
				yMin: axisText(field, min, units),
				xFirst: weekLabel(series[0].week),
				xLast: weekLabel(series[series.length - 1].week)
			};
		}
		view.stats.push({
			label: `${series.length} weeks`,
			value: `${signed(series[series.length - 1].avg - series[0].avg)}${unitSuffix(field, units)}`,
			accent: true
		});
	}

	// The viewer's own bucket lights up only when they are inside the
	// filtered view themselves.
	const b = buckets(numbers, bucketWidth(field, units));
	if (b) {
		const you = valueIn(
			latestValue(group.get(viewerId) ?? [], field.id, filters) ?? undefined,
			units
		);
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
