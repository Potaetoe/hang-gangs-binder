/** Numbers on a chart, the way a person reads them. */

import type { Field } from '../db';
import { formulaUnit } from '../fields';
import { feetInches, round, type Units } from '../units';

/** Compact axis text: heights read as 5'10". */
export function axisText(field: Field, n: number, units: Units): string {
	if (field.measure === 'length' && units === 'imperial') {
		const { feet, inches } = feetInches(n);
		return `${feet}'${round(inches, 0)}"`;
	}
	return String(round(n, 1));
}

export function unitSuffix(field: Field, units: Units): string {
	if (field.measure === 'mass') return units === 'imperial' ? ' lb' : ' kg';
	if (field.measure === 'length') return units === 'imperial' ? ' in' : ' cm';
	const unit = formulaUnit(field);
	return unit ? ` ${unit}` : '';
}

/** A bucket's range: "200–220 lb", "5'6"–5'8"". Imperial heights carry
 * their units in the feet-and-inches marks. */
export function rangeLabel(field: Field, from: number, to: number, units: Units): string {
	const suffix =
		field.measure === 'mass' || (field.measure === 'length' && units === 'metric')
			? unitSuffix(field, units)
			: '';
	return `${axisText(field, from, units)}–${axisText(field, to, units)}${suffix}`;
}

/** A group average: "238 lb", "5 ft 11 in", "31.9". */
export function headlineText(field: Field, n: number, units: Units): string {
	if (field.measure === 'length' && units === 'imperial') {
		const { feet, inches } = feetInches(n);
		return `${feet} ft ${inches} in`;
	}
	return `${round(n, 1)}${unitSuffix(field, units)}`;
}

export const signed = (n: number): string => (n >= 0 ? `+${round(n, 1)}` : String(round(n, 1)));
