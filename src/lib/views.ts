/**
 * Display-ready shapes the server hands to pages. Components stay
 * dumb: everything here is plain strings, so no server module ever
 * leaks into a client bundle.
 */

export type FormFieldView = {
	id: string;
	name: string;
	/** 'length' is the imperial two-box (feet + inches - welcome to
	 * America); metric lengths arrive as 'single' with a cm unit;
	 * 'multi' is a pick-several choice rendered as checkboxes. */
	kind: 'choice' | 'multi' | 'length' | 'single' | 'computed';
	options: string[];
	ft: string;
	inches: string;
	single: string;
	choice: string;
	/** Pick-several only: the picks that arrive pre-checked. */
	picks: string[];
	unit: string;
};

export type TrendView = { name: string; poly: string; latest: string };

/** The entries table: one column per active field, one row per entry. */
export type EntryTableView = {
	columns: string[];
	rows: { id: string; dateLabel: string; cells: string[] }[];
};

/** One event on the calendar card, gallery included. */
export type EventView = {
	id: string;
	dateLabel: string;
	title: string;
	place: string | null;
	notes: string | null;
	imageIds: string[];
};

/** The month grid, painted as-is; null cells pad the edges. */
export type CalendarView = {
	label: string;
	prev: string;
	next: string;
	weekdays: string[];
	weeks: ({ day: number; eventId: string | null; eventCount: number; today: boolean } | null)[][];
};

/** A tile on the charts board: numbers carry a sparkline, choices
 * carry count bars. */
export type TileView = {
	id: string;
	name: string;
	poly: string | null;
	bars: number[];
	headline: string;
	delta: string | null;
};

/** The focused field's page, fully rendered server-side. */
export type FocusView = {
	name: string;
	isChoice: boolean;
	stats: { label: string; value: string; accent: boolean }[];
	trend: {
		poly: string;
		ghost: string | null;
		yMax: string;
		yMid: string;
		yMin: string;
		xFirst: string;
		xLast: string;
	} | null;
	dist: {
		bars: { pct: number; on: boolean; label: string }[];
		from: string;
		to: string;
		you: string | null;
	} | null;
	counts: { label: string; count: number; pct: number }[];
	/** Pick-several fields filter as checkboxes (`multiple`), single
	 * choices as a dropdown; `selected` holds every applied value. */
	filterFields: {
		id: string;
		name: string;
		options: string[];
		multiple: boolean;
		selected: string[];
	}[];
	empty: string | null;
};
