/**
 * Display-ready shapes the server hands to pages. Components stay
 * dumb: everything here is plain strings, so no server module ever
 * leaks into a client bundle.
 */

export type FormFieldView = {
	id: string;
	name: string;
	/** 'length' is the imperial two-box (feet + inches - welcome to
	 * America); metric lengths arrive as 'single' with a cm unit. */
	kind: 'choice' | 'length' | 'single' | 'computed';
	options: string[];
	ft: string;
	inches: string;
	single: string;
	choice: string;
	unit: string;
};

export type TrendView = { name: string; poly: string; latest: string };

export type HistoryRow = { id: string; dateLabel: string; summary: string };

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
	filterFields: { id: string; name: string; options: string[]; selected: string }[];
	empty: string | null;
};
