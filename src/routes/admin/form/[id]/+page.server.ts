import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	addOption,
	allFields,
	deleteField,
	ESSENTIAL,
	makeMultiple,
	removeOption,
	renameField,
	renameOption,
	retireField,
	reviveField,
	saveFormula
} from '$lib/server/form';
import {
	describeFormula,
	isCalculated,
	MAX_STEPS,
	OPS,
	parseBuilderForm,
	parseFormula,
	previewFormula,
	type Operand
} from '$lib/server/calc';
import { fieldOptions, today } from '$lib/server/stats';
import { loadSettings } from '$lib/server/settings';

/** An operand back into the builder's select value. */
const encodePick = (operand: Operand | undefined): { pick: string; constant: string } => {
	if (!operand) return { pick: '', constant: '' };
	if (operand.kind === 'const') return { pick: 'const', constant: String(operand.value) };
	const kind = operand.kind === 'field' ? 'f' : operand.kind;
	return { pick: `${kind}:${operand.id}`, constant: '' };
};

export const load: PageServerLoad = async ({ platform, params }) => {
	const db = getDb(platform!.env.DB);
	const field = (await db.select().from(table.fields).where(eq(table.fields.id, params.id)))[0];
	if (!field) error(404, 'Not found');
	const used = (
		await db
			.select({ fieldId: table.entryValues.fieldId })
			.from(table.entryValues)
			.where(eq(table.entryValues.fieldId, params.id))
			.limit(1)
	)[0];

	// The guided builder's furniture, for calculated fields only.
	let calc = null;
	if (isCalculated(field)) {
		const fields = await allFields(db);
		const formula = parseFormula(field);
		const inputs = fields.filter(
			(f) => f.type === 'number' && !isCalculated(f) && f.status === 'active'
		);
		calc = {
			locked: field.computed === 'bmi',
			recipe: formula ? describeFormula(formula, fields) : null,
			units: formula?.units ?? 'both',
			decimals: formula?.decimals ?? 1,
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

	return {
		field: {
			id: field.id,
			name: field.name,
			isChoice: field.type === 'choice',
			multiple: field.multiple,
			computed: Boolean(field.computed) || isCalculated(field),
			active: field.status === 'active',
			essential: ESSENTIAL.has(field.id),
			options: fieldOptions(field),
			used: Boolean(used)
		},
		calc
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

type Ctx = { request: Request; locals: App.Locals; platform: Readonly<App.Platform> | undefined };

async function run(
	event: Ctx,
	act: (
		db: ReturnType<typeof getDb>,
		date: string,
		actorId: string,
		form: FormData
	) => Promise<{ ok: true } | { ok: false; reason: string }>,
	backTo: string | null = null
) {
	const actor = guard(event.locals);
	const db = getDb(event.platform!.env.DB);
	const form = await event.request.formData();
	const settings = await loadSettings(db);
	const result = await act(db, today(settings.timezone), actor.memberId, form);
	if (!result.ok) return fail(400, { message: result.reason });
	if (backTo) redirect(303, backTo);
	return { done: true };
}

export const actions: Actions = {
	rename: async (event) =>
		run(event, (db, date, actor, form) =>
			renameField(db, date, actor, event.params.id, String(form.get('name') ?? ''))
		),

	retire: async (event) =>
		run(event, (db, date, actor) => retireField(db, date, actor, event.params.id)),

	multiple: async (event) =>
		run(event, (db, date, actor) => makeMultiple(db, date, actor, event.params.id)),

	revive: async (event) =>
		run(event, (db, date, actor) => reviveField(db, date, actor, event.params.id)),

	delete: async (event) =>
		run(event, (db, date, actor) => deleteField(db, date, actor, event.params.id), '/admin/form'),

	addoption: async (event) =>
		run(event, (db, date, actor, form) =>
			addOption(db, date, actor, event.params.id, String(form.get('option') ?? ''))
		),

	renameoption: async (event) =>
		run(event, (db, date, actor, form) =>
			renameOption(
				db,
				date,
				actor,
				event.params.id,
				String(form.get('from') ?? ''),
				String(form.get('to') ?? '')
			)
		),

	removeoption: async (event) =>
		run(event, (db, date, actor, form) =>
			removeOption(db, date, actor, event.params.id, String(form.get('option') ?? ''))
		),

	formula: async (event) => {
		const actor = guard(event.locals);
		const db = getDb(event.platform!.env.DB);
		const form = await event.request.formData();
		const parsed = parseBuilderForm(form, await allFields(db));
		if (!parsed.ok) return fail(400, { problems: parsed.problems, calcRaw: echoBuilder(form) });
		const settings = await loadSettings(db);
		const result = await saveFormula(
			db,
			today(settings.timezone),
			actor.memberId,
			event.params.id,
			parsed.formula
		);
		if (!result.ok) return fail(400, { message: result.reason, calcRaw: echoBuilder(form) });
		return { done: true };
	},

	// The live look before anything is saved (owner ruling 2026-08-26).
	// The picks echo back so the form still holds them - a preview
	// must never cost the admin their unsaved recipe.
	preview: async (event) => {
		guard(event.locals);
		const db = getDb(event.platform!.env.DB);
		const form = await event.request.formData();
		const parsed = parseBuilderForm(form, await allFields(db));
		if (!parsed.ok) return fail(400, { problems: parsed.problems, calcRaw: echoBuilder(form) });
		return { preview: previewFormula(parsed.formula), calcRaw: echoBuilder(form) };
	}
};

/** Everything the builder posted, handed back so the re-rendered
 * form shows what the admin had picked. */
function echoBuilder(form: FormData): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of ['start_pick', 'start_const', 'units', 'decimals']) {
		out[key] = String(form.get(key) ?? '');
	}
	for (let i = 1; i <= MAX_STEPS; i++) {
		for (const part of ['op', 'pick', 'const']) {
			out[`step${i}_${part}`] = String(form.get(`step${i}_${part}`) ?? '');
		}
	}
	return out;
}
