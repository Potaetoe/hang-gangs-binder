/**
 * Imperial and metric, and the numbers members type. Conversion is the
 * part that can be wrong without looking wrong, so it lives here once.
 */

export type Units = 'imperial' | 'metric';

type Cookies = { get(name: string): string | undefined };

/**
 * The Settings choice is the default and lives in the `units` cookie.
 * A page's toggle carries ?u= for one view only and is never stored,
 * so any reload falls back to the default (DESIGN.md, core loop).
 */
export function memberUnits(cookies: Cookies, url?: URL): Units {
	const view = url?.searchParams.get('u');
	if (view === 'metric' || view === 'imperial') return view;
	return cookies.get('units') === 'metric' ? 'metric' : 'imperial';
}

/** The units an entry form was rendered in. It posts them back, so the
 * numbers are read the way the member saw them. */
export function formUnits(form: FormData, cookies: Cookies): Units {
	const posted = form.get('units');
	if (posted === 'metric' || posted === 'imperial') return posted;
	return memberUnits(cookies);
}

/** A stored number in the given system. */
export const valueIn = (
	value: { metric: number | null; imperial: number | null } | undefined,
	units: Units
): number | null => (units === 'imperial' ? value?.imperial : value?.metric) ?? null;

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const IN_PER_FT = 12;

export function round(value: number, places: number): number {
	const factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
}

/** No stat here reaches a million of anything, so anything bigger is a
 * typo or an attack. Charts size themselves from stored values, so this
 * cap also bounds what a chart can be made to build. */
export const NUMBER_MAX = 1_000_000;

/**
 * A positive number, or null. Strict because Number('') is 0 and
 * parseFloat('5kg') is 5, and neither is what anyone meant. A comma
 * decimal is fine. `allowZero` is for the inches box: 6 ft 0 in is real.
 */
export function parseNumber(text: string, allowZero = false): number | null {
	const value = text.trim().replace(',', '.');
	if (value === '' || !/^\d*\.?\d+$/.test(value)) return null;
	const number = Number(value);
	if (!Number.isFinite(number) || number > NUMBER_MAX) return null;
	return number > 0 || (allowZero && number === 0) ? number : null;
}

/** Split from the total so the two can never disagree; 5 ft 11.98 in
 * rounds up to 6 ft 0 in, not 5 ft 12 in. */
export function feetInches(totalInches: number): { feet: number; inches: number } {
	let feet = Math.floor(totalInches / IN_PER_FT);
	let inches = round(totalInches - feet * IN_PER_FT, 1);
	if (inches >= IN_PER_FT) {
		feet += 1;
		inches = 0;
	}
	return { feet, inches };
}

export const fromLb = (lb: number) => ({
	metric: round(lb * KG_PER_LB, 1),
	imperial: round(lb, 1)
});
export const fromKg = (kg: number) => ({
	metric: round(kg, 1),
	imperial: round(kg / KG_PER_LB, 1)
});
export const fromInches = (inches: number) => ({
	metric: round(inches * CM_PER_IN, 1),
	imperial: round(inches, 1)
});
export const fromCm = (cm: number) => ({
	metric: round(cm, 1),
	imperial: round(cm / CM_PER_IN, 1)
});
