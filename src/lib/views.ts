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
