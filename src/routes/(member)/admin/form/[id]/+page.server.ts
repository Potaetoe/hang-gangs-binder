import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { getDb, type Db } from '$lib/server/db';
import {
	addOption,
	allFields,
	deleteField,
	echoRecipeForm,
	ESSENTIAL,
	fieldOptions,
	hasValues,
	isCalculated,
	makeMultiple,
	parseRecipeForm,
	previewFormula,
	recipeBuilderView,
	recipesReading,
	removeOption,
	renameField,
	renameOption,
	retireField,
	reviveField,
	saveFormula,
	type BuilderResult
} from '$lib/server/fields';
import { siteDay } from '$lib/server/settings';

export const load: PageServerLoad = async ({ platform, params }) => {
	const db = getDb(platform!.env.DB);
	const fields = await allFields(db);
	const field = fields.find((f) => f.id === params.id);
	if (!field) error(404, 'Not found');
	const used = await hasValues(db, field.id);
	return {
		field: {
			id: field.id,
			name: field.name,
			isChoice: field.type === 'choice',
			multiple: field.multiple,
			computed: isCalculated(field),
			active: field.status === 'active',
			essential: ESSENTIAL.has(field.id),
			options: fieldOptions(field),
			used
		},
		// These recipes go blank if this field leaves the form.
		readBy: recipesReading(fields, field.id),
		calc: isCalculated(field) ? recipeBuilderView(field, fields, used) : null
	};
};

/** Runs one builder action as the signed-in admin and reports back. */
async function run(
	{ request, locals, platform }: RequestEvent,
	act: (db: Db, date: string, actorId: string, form: FormData) => Promise<BuilderResult>,
	backTo: string | null = null
) {
	const db = getDb(platform!.env.DB);
	const form = await request.formData();
	const result = await act(db, await siteDay(db), locals.member!.memberId, form);
	if (!result.ok) return fail(400, { message: result.reason });
	if (backTo) redirect(303, backTo);
	return { done: true };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '');

export const actions: Actions = {
	rename: (event) =>
		run(event, (db, date, actor, form) =>
			renameField(db, date, actor, event.params.id, text(form, 'name'))
		),

	retire: (event) => run(event, (db, date, actor) => retireField(db, date, actor, event.params.id)),

	multiple: (event) =>
		run(event, (db, date, actor) => makeMultiple(db, date, actor, event.params.id)),

	revive: (event) => run(event, (db, date, actor) => reviveField(db, date, actor, event.params.id)),

	delete: (event) =>
		run(event, (db, date, actor) => deleteField(db, date, actor, event.params.id), '/admin/form'),

	addoption: (event) =>
		run(event, (db, date, actor, form) =>
			addOption(db, date, actor, event.params.id, text(form, 'option'))
		),

	renameoption: (event) =>
		run(event, (db, date, actor, form) =>
			renameOption(db, date, actor, event.params.id, text(form, 'from'), text(form, 'to'))
		),

	removeoption: (event) =>
		run(event, (db, date, actor, form) =>
			removeOption(db, date, actor, event.params.id, text(form, 'option'))
		),

	formula: async ({ request, locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const parsed = parseRecipeForm(form, await allFields(db));
		if (!parsed.ok) return fail(400, { problems: parsed.problems, calcRaw: echoRecipeForm(form) });
		const result = await saveFormula(
			db,
			await siteDay(db),
			locals.member!.memberId,
			params.id,
			parsed.formula
		);
		if (!result.ok) return fail(400, { message: result.reason, calcRaw: echoRecipeForm(form) });
		return { done: true };
	},

	// A preview never costs the admin their unsaved recipe: the picks
	// echo back so the form still holds them.
	preview: async ({ request, platform }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const parsed = parseRecipeForm(form, await allFields(db));
		if (!parsed.ok) return fail(400, { problems: parsed.problems, calcRaw: echoRecipeForm(form) });
		return { preview: previewFormula(parsed.formula), calcRaw: echoRecipeForm(form) };
	}
};
