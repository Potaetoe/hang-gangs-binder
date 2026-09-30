import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { computeCalculated, loadFields } from '$lib/server/fields';
import {
	deleteEntry,
	echoEntryForm,
	editEntry,
	formFieldViews,
	historyFor,
	memberEntry,
	parseEntryForm
} from '$lib/server/entries';
import { siteDay } from '$lib/server/settings';
import { formatDay } from '$lib/server/days';
import { formUnits, memberUnits } from '$lib/server/units';

export const load: PageServerLoad = async ({ locals, platform, params, cookies }) => {
	const db = getDb(platform!.env.DB);
	// Someone else's entry is simply not found.
	const found = await memberEntry(db, locals.member!.memberId, params.id);
	if (!found) error(404, 'Not found');
	const units = memberUnits(cookies);
	const values = Object.fromEntries(found.values.map((v) => [v.fieldId, v]));
	return {
		dateLabel: formatDay(found.entry.date),
		units,
		formFields: formFieldViews(await loadFields(db), values, units)
	};
};

export const actions: Actions = {
	save: async ({ request, locals, platform, params, cookies }) => {
		const db = getDb(platform!.env.DB);
		const { memberId } = locals.member!;
		const form = await request.formData();
		const fields = await loadFields(db);
		const { values, problems } = parseEntryForm(fields, form, formUnits(form, cookies));
		// Unlike a new entry, nothing carries forward: an emptied box here
		// really removes that value.
		if (!problems.length && !Object.keys(values).length) {
			problems.push('Nothing to save - fill in at least one field, or delete the entry.');
		}
		if (problems.length) return fail(400, { problems, raw: echoEntryForm(form) });

		const edited = await memberEntry(db, memberId, params.id);
		if (!edited) error(404, 'Not found');
		// First and previous are read as of the entry being corrected.
		computeCalculated(fields, values, await historyFor(db, memberId, edited.entry));
		await editEntry(db, edited, values, await siteDay(db));
		redirect(303, '/home');
	},

	delete: async ({ locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		if (!(await deleteEntry(db, locals.member!.memberId, params.id, await siteDay(db)))) {
			error(404, 'Not found');
		}
		redirect(303, '/home');
	}
};
