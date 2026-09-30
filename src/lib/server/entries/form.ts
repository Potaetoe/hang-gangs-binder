import type { EntryValue, Field, NewValues } from '../db';
import type { FormFieldView } from '$lib/views';
import {
	choicePicks,
	fieldOptions,
	formulaInputNames,
	isCalculated,
	parseFormula
} from '../fields';
import {
	feetInches,
	fromCm,
	fromInches,
	fromKg,
	fromLb,
	IN_PER_FT,
	NUMBER_MAX,
	parseNumber,
	type Units
} from '../units';

const blankView = (field: Field): FormFieldView => ({
	id: field.id,
	name: field.name,
	kind: 'single',
	options: [],
	ft: '',
	inches: '',
	single: '',
	choice: '',
	picks: [],
	unit: ''
});

const listNames = (names: string[]): string =>
	names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');

/** Each field as its inputs, pre-filled in the member's units. Imperial
 * heights are always feet and inches, never a bare inch count. */
export function formFieldViews(
	fields: Field[],
	values: Record<string, EntryValue>,
	units: Units
): FormFieldView[] {
	const imperial = units === 'imperial';
	return fields.map((field) => {
		const view = blankView(field);
		const v = values[field.id];
		if (isCalculated(field)) {
			const formula = parseFormula(field);
			view.kind = 'computed';
			view.computedFrom =
				(formula && listNames(formulaInputNames(formula, fields))) || 'other fields';
		} else if (field.type === 'choice') {
			view.kind = field.multiple ? 'multi' : 'choice';
			view.options = fieldOptions(field);
			view.picks = v ? choicePicks(v) : [];
			view.choice = v?.choice ?? '';
		} else if (field.measure === 'length' && imperial) {
			view.kind = 'length';
			if (v?.imperial != null) {
				const { feet, inches } = feetInches(v.imperial);
				view.ft = String(feet);
				view.inches = String(inches);
			}
		} else {
			const n = imperial ? v?.imperial : v?.metric;
			if (n != null) view.single = String(n);
			if (field.measure === 'length') view.unit = 'cm';
			if (field.measure === 'mass') view.unit = imperial ? 'lb' : 'kg';
		}
		return view;
	});
}

/**
 * Reads a submitted entry against the field list. Every field is
 * optional, but a filled one must parse. All problems come back at
 * once, so two typos cost one round trip, not two.
 */
export function parseEntryForm(
	fields: Field[],
	form: FormData,
	units: Units
): { values: NewValues; problems: string[] } {
	const values: NewValues = {};
	const problems: string[] = [];
	const imperial = units === 'imperial';
	const text = (key: string) => String(form.get(key) ?? '').trim();
	const number = (n: { metric: number; imperial: number }, entered: string) => ({
		...n,
		entered,
		choice: null
	});
	const choice = (value: string) => ({
		metric: null,
		imperial: null,
		entered: null,
		choice: value
	});

	for (const field of fields) {
		const key = `f_${field.id}`;
		if (isCalculated(field)) continue;

		if (field.type === 'choice') {
			const options = fieldOptions(field);
			const ticked = form
				.getAll(key)
				.filter((v): v is string => typeof v === 'string')
				.map((v) => v.trim())
				.filter(Boolean);
			// No ticks parses as nothing here; carryForward decides whether
			// that silence means "none now".
			if (!ticked.length) continue;
			if (ticked.some((t) => !options.includes(t))) {
				problems.push(`${field.name}: that is not one of the choices.`);
				continue;
			}
			// Stored in the options' order: the answer is a set, and it
			// should read the same however the boxes were ticked.
			values[field.id] = field.multiple
				? choice(JSON.stringify(options.filter((o) => ticked.includes(o))))
				: choice(ticked[0]);
			continue;
		}

		if (field.measure === 'length' && imperial) {
			const ftRaw = text(`${key}_ft`);
			const inRaw = text(`${key}_in`);
			if (!ftRaw && !inRaw) continue;
			// Either box may be zero; the total must not.
			const feet = ftRaw ? parseNumber(ftRaw, true) : 0;
			const inches = inRaw ? parseNumber(inRaw, true) : 0;
			if (feet === null || inches === null) {
				problems.push(`${field.name}: enter feet and inches as numbers, below a million.`);
				continue;
			}
			const total = feet * IN_PER_FT + inches;
			if (total <= 0) continue;
			// Each box is capped, but the total can still clear the ceiling.
			if (total > NUMBER_MAX) {
				problems.push(`${field.name}: that is too large to be real.`);
				continue;
			}
			values[field.id] = number(fromInches(total), `${ftRaw || '0'} ft ${inRaw || '0'} in`);
			continue;
		}

		const raw = text(key);
		if (!raw) continue;
		const n = parseNumber(raw);
		if (n === null) {
			problems.push(`${field.name}: enter a number above zero, below a million.`);
			continue;
		}
		if (field.measure === 'length') values[field.id] = number(fromCm(n), `${raw} cm`);
		else if (field.measure === 'mass') {
			values[field.id] = imperial ? number(fromLb(n), `${raw} lb`) : number(fromKg(n), `${raw} kg`);
		} else values[field.id] = number({ metric: n, imperial: n }, raw);
	}

	return { values, problems };
}

/**
 * A blank field on a new entry keeps its last value: nobody re-enters
 * what they already told the binder. (Editing an entry is the opposite;
 * there, clearing a field removes it.)
 */
export function carryForward(
	fields: Field[],
	values: NewValues,
	latest: Record<string, EntryValue>
) {
	for (const field of fields) {
		const prior = latest[field.id];
		if (isCalculated(field) || values[field.id] || !prior) continue;
		if (field.type === 'choice' && field.multiple) {
			// The boxes arrive pre-checked with the latest picks, so the
			// pre-fill is the carry. A submit with none ticked means the
			// member cleared them on purpose: record "none now".
			if (choicePicks(prior).length) {
				values[field.id] = { metric: null, imperial: null, entered: null, choice: '[]' };
			}
			continue;
		}
		const { metric, imperial, entered, choice } = prior;
		values[field.id] = { metric, imperial, entered, choice };
	}
}

/** What a failed submit typed, echoed back over the pre-fill so a typo
 * never costs the rest. Checkboxes repeat their name, so each key is a
 * list. */
export function echoEntryForm(form: FormData): Record<string, string[]> {
	const raw: Record<string, string[]> = {};
	for (const [key, value] of form.entries()) {
		if (key.startsWith('f_') && typeof value === 'string') (raw[key] ??= []).push(value);
	}
	return raw;
}
