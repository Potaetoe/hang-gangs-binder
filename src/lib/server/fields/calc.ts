/**
 * Calculated fields (DESIGN.md feature 7). A recipe is a starting value
 * and steps worked left to right, computed when an entry is saved and
 * stored like any typed number. Anything missing, a division by zero or
 * a result past the ceiling gives a blank: a zero would pretend to be
 * data.
 */

import type { EntryValue, Field, NewValues } from '../db';
import { NUMBER_MAX, round, valueIn, type Units } from '../units';

export type Operand =
	| { kind: 'field'; id: string }
	| { kind: 'first'; id: string }
	| { kind: 'prev'; id: string }
	| { kind: 'const'; value: number };

export type CalcOp = 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'min' | 'max';
export type CalcStep = { op: CalcOp; value: Operand };

export type Formula = {
	start: Operand;
	steps: CalcStep[];
	/** 'metric' is one number for everyone, worked from metric values
	 * (right for ratios like BMI). 'both' is worked once per system, so
	 * it follows the units toggle (right for gains and differences). */
	units: 'metric' | 'both';
	decimals: 0 | 1 | 2;
	/** Shown after the number, like "kg" or "%". */
	unit?: string;
};

export const MAX_STEPS = 5;
export const UNIT_MAX = 8;
export const OPS: Record<CalcOp, string> = {
	add: '+',
	sub: '−',
	mul: '×',
	div: '÷',
	pow: '^',
	min: 'min',
	max: 'max'
};
/** Keeps a power step from producing absurd numbers. */
const POW_LIMIT = 10;

export const cleanUnit = (raw: unknown): string =>
	typeof raw === 'string' ? raw.trim().slice(0, UNIT_MAX) : '';

/** Own-property check, so names like "toString" are not operations. */
export const isOp = (op: unknown): op is CalcOp => Object.hasOwn(OPS, String(op));

const isOperand = (raw: unknown): raw is Operand => {
	if (typeof raw !== 'object' || raw === null) return false;
	const o = raw as Record<string, unknown>;
	if (o.kind === 'const') return typeof o.value === 'number' && Number.isFinite(o.value);
	return (
		(o.kind === 'field' || o.kind === 'first' || o.kind === 'prev') && typeof o.id === 'string'
	);
};

/** A field is calculated as soon as it has a formula column, even an
 * unfinished '{}'. */
export const isCalculated = (field: Field): boolean => field.formula !== null;

/** The stored recipe, or null while it is unfinished or unreadable. */
export function parseFormula(field: Field): Formula | null {
	if (!field.formula) return null;
	try {
		const raw = JSON.parse(field.formula) as Record<string, unknown>;
		if (!isOperand(raw.start) || !Array.isArray(raw.steps) || raw.steps.length > MAX_STEPS) {
			return null;
		}
		for (const step of raw.steps as Record<string, unknown>[]) {
			if (typeof step !== 'object' || step === null || !isOp(step.op) || !isOperand(step.value)) {
				return null;
			}
		}
		const units = raw.units === 'both' ? 'both' : 'metric';
		const decimals = raw.decimals === 0 || raw.decimals === 2 ? raw.decimals : 1;
		const unit = cleanUnit(raw.unit);
		return {
			start: raw.start,
			steps: raw.steps as CalcStep[],
			units,
			decimals,
			...(unit && { unit })
		};
	} catch {
		return null;
	}
}

/** A calculated field's unit label; typed fields carry theirs in `measure`. */
export const formulaUnit = (field: Field): string =>
	field.formula ? (parseFormula(field)?.unit ?? '') : '';

export type Resolve = (operand: Operand) => number | null;

export function evaluate(formula: Formula, resolve: Resolve): number | null {
	let total = resolve(formula.start);
	if (total === null) return null;
	for (const step of formula.steps) {
		const value = resolve(step.value);
		if (value === null) return null;
		switch (step.op) {
			case 'add':
				total += value;
				break;
			case 'sub':
				total -= value;
				break;
			case 'mul':
				total *= value;
				break;
			case 'div':
				if (value === 0) return null;
				total /= value;
				break;
			case 'pow':
				if (Math.abs(value) > POW_LIMIT) return null;
				total = Math.pow(total, value);
				break;
			case 'min':
				total = Math.min(total, value);
				break;
			case 'max':
				total = Math.max(total, value);
				break;
		}
		if (!Number.isFinite(total)) return null;
	}
	if (Math.abs(total) > NUMBER_MAX) return null;
	return round(total, formula.decimals);
}

export type HistoryValues = {
	/** Per field, the member's earliest stored value. */
	first: Record<string, EntryValue>;
	/** Per field, the latest stored value before this entry. */
	prev: Record<string, EntryValue>;
};

/**
 * Writes every calculated field's value into `values`, beside the typed
 * ones. Runs after carry-forward, so carried numbers count. With no
 * history, first and previous read this entry's own value: a first
 * entry's gain is zero, not blank.
 */
export function computeCalculated(fields: Field[], values: NewValues, history: HistoryValues) {
	for (const field of fields) {
		const formula = parseFormula(field);
		if (!formula) continue;
		const resolveIn =
			(system: Units): Resolve =>
			(operand) => {
				if (operand.kind === 'const') return operand.value;
				const own = valueIn(values[operand.id], system);
				if (operand.kind === 'field') return own;
				return valueIn(history[operand.kind][operand.id], system) ?? own;
			};
		const metric = evaluate(formula, resolveIn('metric'));
		const imperial = formula.units === 'metric' ? metric : evaluate(formula, resolveIn('imperial'));
		if (metric === null || imperial === null) continue;
		values[field.id] = { metric, imperial, entered: null, choice: null };
	}
}

/* Words for people */

const operandIds = (formula: Formula): Operand[] => [
	formula.start,
	...formula.steps.map((s) => s.value)
];

/** Every field id a recipe reads, however it reads it. */
export function formulaReads(formula: Formula): string[] {
	const ids = operandIds(formula).flatMap((o) => (o.kind === 'const' ? [] : [o.id]));
	return [...new Set(ids)];
}

/** The recipes that read a field, by name. Taking that field off the
 * form blanks them, so admins are warned before they do. */
export function recipesReading(fields: Field[], fieldId: string): string[] {
	return fields
		.filter((f) => {
			if (f.id === fieldId) return false;
			const formula = parseFormula(f);
			return formula !== null && formulaReads(formula).includes(fieldId);
		})
		.map((f) => f.name);
}

/** The input names for the member form's "worked out from" note. It
 * names the inputs, never the math. */
export function formulaInputNames(formula: Formula, fields: Field[]): string[] {
	const names = formulaReads(formula).map((id) => fields.find((f) => f.id === id)?.name);
	return [...new Set(names.filter((n): n is string => Boolean(n)))];
}

const operandName = (operand: Operand, fields: Field[]): string => {
	if (operand.kind === 'const') return String(operand.value);
	const name = fields.find((f) => f.id === operand.id)?.name ?? 'a departed field';
	if (operand.kind === 'first') return `${name} (first entry)`;
	if (operand.kind === 'prev') return `${name} (previous entry)`;
	return name;
};

/** The whole recipe in words, for admins. The unit rides along so a
 * unit-only change still reads as a change in the log. */
export function describeFormula(formula: Formula, fields: Field[]): string {
	const parts = [operandName(formula.start, fields)];
	for (const step of formula.steps)
		parts.push(`${OPS[step.op]} ${operandName(step.value, fields)}`);
	return parts.join(' ') + (formula.unit ? `, shown as "${formula.unit}"` : '');
}
