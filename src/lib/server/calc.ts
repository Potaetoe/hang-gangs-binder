/**
 * Calculated fields (DESIGN.md feature 7, owner rulings 2026-08-26):
 * the guided builder's chain, evaluated at save time and stored like
 * any typed number - forward only, old values standing. A formula is
 * a starting value and steps worked left to right; operands are
 * typed number fields, the member's first or previous entry's value
 * of one, or a constant. Any missing piece, division by zero, or a
 * result past the number ceiling means BLANK - never a zero
 * pretending to be data.
 */

import type { Field, EntryValue, ParsedValues, Units } from './stats';

// Mirrors stats.NUMBER_MAX - imported as a type-only neighbour so
// stats.ts can import this module without a value cycle.
const NUMBER_CEILING = 1_000_000;

const round = (value: number, places: number): number => {
	const factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
};

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
	/** 'metric' = one number for everyone, from metric values (the
	 * BMI way); 'both' = computed once per system, so the answer
	 * follows the units toggle (the weight-gain way). */
	units: 'metric' | 'both';
	decimals: 0 | 1 | 2;
};

export const MAX_STEPS = 5;
export const OPS: Record<CalcOp, string> = {
	add: '+',
	sub: '−',
	mul: '×',
	div: '÷',
	pow: '^',
	min: 'min',
	max: 'max'
};
const POW_LIMIT = 10;

const isOperand = (raw: unknown): raw is Operand => {
	if (typeof raw !== 'object' || raw === null) return false;
	const o = raw as Record<string, unknown>;
	if (o.kind === 'const') return typeof o.value === 'number' && Number.isFinite(o.value);
	return (
		(o.kind === 'field' || o.kind === 'first' || o.kind === 'prev') && typeof o.id === 'string'
	);
};

/** The stored JSON, or null when the field has no working recipe yet
 * (a fresh calculated field carries '{}' until the admin saves one). */
export function parseFormula(field: Field): Formula | null {
	if (!field.formula) return null;
	try {
		const raw = JSON.parse(field.formula) as Record<string, unknown>;
		if (!isOperand(raw.start)) return null;
		const steps = Array.isArray(raw.steps) ? raw.steps : null;
		if (!steps || steps.length > MAX_STEPS) return null;
		for (const step of steps as Record<string, unknown>[]) {
			if (typeof step !== 'object' || step === null) return null;
			if (!(String(step.op) in OPS)) return null;
			if (!isOperand(step.value)) return null;
		}
		const units = raw.units === 'both' ? 'both' : 'metric';
		const decimals = raw.decimals === 0 || raw.decimals === 2 ? raw.decimals : 1;
		return { start: raw.start, steps: steps as CalcStep[], units, decimals };
	} catch {
		return null;
	}
}

/** A field is calculated when it carries a formula column at all -
 * even an unfinished one. */
export const isCalculated = (field: Field): boolean => field.formula !== null;

/* ---------------------------------------------------------------- */
/* Evaluation                                                        */

export type HistoryValues = {
	/** Per field: the member's earliest stored value. */
	first: Record<string, EntryValue>;
	/** Per field: the latest stored value before this entry. */
	prev: Record<string, EntryValue>;
};

type Resolve = (operand: Operand) => number | null;

function evaluate(formula: Formula, resolve: Resolve): number | null {
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
	if (!Number.isFinite(total) || Math.abs(total) > NUMBER_CEILING) return null;
	return round(total, formula.decimals);
}

type BothSystems = { metric: number | null; imperial: number | null };

const systemValue = (value: BothSystems | undefined, system: Units): number | null => {
	const n = system === 'metric' ? value?.metric : value?.imperial;
	return n ?? null;
};

/**
 * Every calculated field's value for one entry, written into `values`
 * beside the typed ones. Runs after carryForward, so carried numbers
 * count. First/previous fall back to THIS entry's own value when the
 * member has no history - a first entry's gain is zero, not blank.
 */
export function computeCalculated(
	fields: Field[],
	values: ParsedValues,
	history: HistoryValues
): void {
	for (const field of fields) {
		if (!isCalculated(field)) continue;
		const formula = parseFormula(field);
		if (!formula) continue;

		const resolveIn =
			(system: Units): Resolve =>
			(operand) => {
				if (operand.kind === 'const') return operand.value;
				const own = values[operand.id];
				if (operand.kind === 'field') return systemValue(own, system);
				const stored = history[operand.kind === 'first' ? 'first' : 'prev'][operand.id];
				return systemValue(stored, system) ?? systemValue(own, system);
			};

		if (formula.units === 'metric') {
			const result = evaluate(formula, resolveIn('metric'));
			if (result === null) continue;
			values[field.id] = { metric: result, imperial: result, entered: null, choice: null };
		} else {
			const metric = evaluate(formula, resolveIn('metric'));
			const imperial = evaluate(formula, resolveIn('imperial'));
			if (metric === null || imperial === null) continue;
			values[field.id] = { metric, imperial, entered: null, choice: null };
		}
	}
}

/* ---------------------------------------------------------------- */
/* Words for people                                                  */

const operandName = (operand: Operand, fields: Field[]): string => {
	if (operand.kind === 'const') return String(operand.value);
	const name = fields.find((f) => f.id === operand.id)?.name ?? 'a departed field';
	if (operand.kind === 'first') return `${name} (first entry)`;
	if (operand.kind === 'prev') return `${name} (previous entry)`;
	return name;
};

/** Every field id a formula reads, however it reads it - for the
 * "this will go blank" warnings when an input leaves the form. */
export function formulaReads(formula: Formula): string[] {
	const ids: string[] = [];
	const add = (operand: Operand) => {
		if (operand.kind !== 'const' && !ids.includes(operand.id)) ids.push(operand.id);
	};
	add(formula.start);
	for (const step of formula.steps) add(step.value);
	return ids;
}

/** The unique FIELD names a formula reads - the member-facing
 * "worked out from" note names inputs, never the math. */
export function formulaInputNames(formula: Formula, fields: Field[]): string[] {
	const names: string[] = [];
	const add = (operand: Operand) => {
		if (operand.kind === 'const') return;
		const name = fields.find((f) => f.id === operand.id)?.name;
		if (name && !names.includes(name)) names.push(name);
	};
	add(formula.start);
	for (const step of formula.steps) add(step.value);
	return names;
}

/** The whole recipe in words, for admin eyes. */
export function describeFormula(formula: Formula, fields: Field[]): string {
	const parts = [operandName(formula.start, fields)];
	for (const step of formula.steps) {
		parts.push(`${OPS[step.op]} ${operandName(step.value, fields)}`);
	}
	return parts.join(' ');
}

/* ---------------------------------------------------------------- */
/* The guided builder's form                                         */

const CONST_SHAPE = /^-?\d*\.?\d+$/;

/** The select values the builder posts: f:<id>, first:<id>,
 * prev:<id>, or 'const' with the number beside it. */
function decodeOperand(
	pick: string,
	constant: string,
	fields: Field[],
	problems: string[],
	where: string
): Operand | null {
	if (pick === 'const') {
		const cleaned = constant.trim().replace(',', '.');
		if (!CONST_SHAPE.test(cleaned) || Math.abs(Number(cleaned)) > NUMBER_CEILING) {
			problems.push(`${where}: type a number, below a million.`);
			return null;
		}
		return { kind: 'const', value: Number(cleaned) };
	}
	const [kind, id] = pick.split(':');
	if ((kind === 'f' || kind === 'first' || kind === 'prev') && id) {
		const input = fields.find((x) => x.id === id);
		if (!input || input.type !== 'number' || isCalculated(input)) {
			problems.push(`${where}: a recipe reads typed number fields only.`);
			return null;
		}
		return { kind: kind === 'f' ? 'field' : kind, id };
	}
	problems.push(`${where}: pick what it reads.`);
	return null;
}

export type BuilderParse = { ok: true; formula: Formula } | { ok: false; problems: string[] };

/** Reads the builder's posted rows; every fault at once. Blank step
 * rows (no operation picked) are simply unused. */
export function parseBuilderForm(form: FormData, fields: Field[]): BuilderParse {
	const problems: string[] = [];
	const start = decodeOperand(
		String(form.get('start_pick') ?? ''),
		String(form.get('start_const') ?? ''),
		fields,
		problems,
		'Start'
	);
	const steps: CalcStep[] = [];
	for (let i = 1; i <= MAX_STEPS; i++) {
		const op = String(form.get(`step${i}_op`) ?? '');
		if (!op) continue;
		if (!(op in OPS)) {
			problems.push(`Step ${i}: pick an operation.`);
			continue;
		}
		const value = decodeOperand(
			String(form.get(`step${i}_pick`) ?? ''),
			String(form.get(`step${i}_const`) ?? ''),
			fields,
			problems,
			`Step ${i}`
		);
		if (value) steps.push({ op: op as CalcOp, value });
	}
	const units = form.get('units') === 'metric' ? 'metric' : 'both';
	const rawDecimals = Number(form.get('decimals'));
	const decimals = rawDecimals === 0 || rawDecimals === 2 ? rawDecimals : 1;
	if (problems.length || !start) return { ok: false, problems };
	return { ok: true, formula: { start, steps, units, decimals } };
}

/** The preview's sample answer: every field reads 100, a first-entry
 * value 90, a previous-entry value 95 - deterministic on purpose, so
 * the admin can check the arithmetic by hand. */
export function previewFormula(formula: Formula): string {
	const resolve: Resolve = (operand) => {
		if (operand.kind === 'const') return operand.value;
		if (operand.kind === 'first') return 90;
		if (operand.kind === 'prev') return 95;
		return 100;
	};
	const result = evaluate(formula, resolve);
	return result === null
		? 'blank (the recipe cannot be worked with those numbers)'
		: String(result);
}
