/**
 * The guided recipe builder's form: admins pick from lists and never
 * type an expression. Its selects post values like f:<id>, first:<id>,
 * prev:<id>, or 'const' with the number in a box beside it.
 */

import type { Field } from '../db';
import {
	cleanUnit,
	describeFormula,
	evaluate,
	isCalculated,
	isOp,
	MAX_STEPS,
	OPS,
	parseFormula,
	type CalcStep,
	type Formula,
	type Operand
} from './calc';
import { NUMBER_MAX } from '../units';

const CONST_SHAPE = /^-?\d*\.?\d+$/;

/** Recipes read typed number fields only, so one calculated field never
 * feeds another. */
const readable = (field: Field | undefined): boolean =>
	field?.type === 'number' && !isCalculated(field);

function decodeOperand(
	pick: string,
	constant: string,
	fields: Field[],
	problems: string[],
	where: string
): Operand | null {
	if (pick === 'const') {
		const cleaned = constant.trim().replace(',', '.');
		if (!CONST_SHAPE.test(cleaned) || Math.abs(Number(cleaned)) > NUMBER_MAX) {
			problems.push(`${where}: type a number, below a million.`);
			return null;
		}
		return { kind: 'const', value: Number(cleaned) };
	}
	const [kind, id] = pick.split(':');
	if ((kind === 'f' || kind === 'first' || kind === 'prev') && id) {
		if (!readable(fields.find((f) => f.id === id))) {
			problems.push(`${where}: a recipe reads typed number fields only.`);
			return null;
		}
		return { kind: kind === 'f' ? 'field' : kind, id };
	}
	problems.push(`${where}: pick what it reads.`);
	return null;
}

const encodePick = (operand: Operand | undefined): { pick: string; constant: string } => {
	if (!operand) return { pick: '', constant: '' };
	if (operand.kind === 'const') return { pick: 'const', constant: String(operand.value) };
	return { pick: `${operand.kind === 'field' ? 'f' : operand.kind}:${operand.id}`, constant: '' };
};

/** Reads the posted rows, every fault at once. A step row with no
 * operation picked is simply unused. */
export function parseRecipeForm(
	form: FormData,
	fields: Field[]
): { ok: true; formula: Formula } | { ok: false; problems: string[] } {
	const problems: string[] = [];
	const text = (key: string) => String(form.get(key) ?? '');
	const start = decodeOperand(text('start_pick'), text('start_const'), fields, problems, 'Start');
	const steps: CalcStep[] = [];
	for (let i = 1; i <= MAX_STEPS; i++) {
		const op = text(`step${i}_op`);
		if (!op) continue;
		if (!isOp(op)) {
			problems.push(`Step ${i}: pick an operation.`);
			continue;
		}
		const value = decodeOperand(
			text(`step${i}_pick`),
			text(`step${i}_const`),
			fields,
			problems,
			`Step ${i}`
		);
		if (value) steps.push({ op, value });
	}
	const units = form.get('units') === 'metric' ? 'metric' : 'both';
	const rawDecimals = Number(form.get('decimals'));
	const decimals = rawDecimals === 0 || rawDecimals === 2 ? rawDecimals : 1;
	const unit = cleanUnit(form.get('unit_label'));
	if (problems.length || !start) return { ok: false, problems };
	return { ok: true, formula: { start, steps, units, decimals, ...(unit && { unit }) } };
}

/** Everything the builder posted, so a re-rendered form keeps the
 * admin's unsaved picks. */
export function echoRecipeForm(form: FormData): Record<string, string> {
	const keys = ['start_pick', 'start_const', 'units', 'decimals', 'unit_label'];
	for (let i = 1; i <= MAX_STEPS; i++) {
		keys.push(`step${i}_op`, `step${i}_pick`, `step${i}_const`);
	}
	return Object.fromEntries(keys.map((key) => [key, String(form.get(key) ?? '')]));
}

/** A sample answer with fixed inputs (every field 100, first entry 90,
 * previous entry 95), so the admin can check the arithmetic by hand. */
export function previewFormula(formula: Formula): string {
	const sample = { field: 100, first: 90, prev: 95 };
	const result = evaluate(formula, (o) => (o.kind === 'const' ? o.value : sample[o.kind]));
	if (result === null) return 'blank (the recipe cannot be worked with those numbers)';
	return formula.unit ? `${result} ${formula.unit}` : String(result);
}

/** What the builder page needs to draw a calculated field's recipe. */
export function recipeBuilderView(field: Field, fields: Field[], hasValues: boolean) {
	const formula = parseFormula(field);
	const inputs = fields.filter((f) => readable(f) && f.status === 'active');
	return {
		// BMI never changes. Any other recipe locks once its field holds a
		// value, so one field's history always comes from one formula.
		locked: field.computed === 'bmi' ? 'bmi' : hasValues ? 'values' : null,
		recipe: formula ? describeFormula(formula, fields) : null,
		units: formula?.units ?? 'both',
		decimals: formula?.decimals ?? 1,
		unitLabel: formula?.unit ?? '',
		start: encodePick(formula?.start),
		steps: Array.from({ length: MAX_STEPS }, (_, i) => {
			const step = formula?.steps[i];
			return { op: step?.op ?? '', ...encodePick(step?.value) };
		}),
		ops: Object.entries(OPS).map(([value, label]) => ({ value, label })),
		choices: inputs.flatMap((f) => [
			{ value: `f:${f.id}`, label: f.name },
			{ value: `first:${f.id}`, label: `${f.name} (first entry)` },
			{ value: `prev:${f.id}`, label: `${f.name} (previous entry)` }
		])
	};
}
