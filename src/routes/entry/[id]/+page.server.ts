import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings } from '$lib/server/settings';
import {
	computeBmi,
	deleteEntry,
	editEntry,
	formatDate,
	formFieldViews,
	loadFields,
	memberEntry,
	memberUnits,
	parseEntryForm,
	today,
	type EntryValue
} from '$lib/server/stats';

const rawEcho = (form: FormData): Record<string, string[]> => {
	const raw: Record<string, string[]> = {};
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('f_') || typeof value !== 'string') continue;
		(raw[key] ??= []).push(value);
	}
	return raw;
};

export const load: PageServerLoad = async ({ locals, platform, params, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	// Yours or not found - the page does not confirm other people's
	// entry ids exist.
	const found = await memberEntry(db, locals.member.memberId, params.id);
	if (!found) error(404, 'Not found');
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	const values: Record<string, EntryValue> = Object.fromEntries(
		found.values.map((v) => [v.fieldId, v])
	);
	return {
		dateLabel: formatDate(found.entry.date),
		units,
		formFields: formFieldViews(fields, values, units)
	};
};

export const actions: Actions = {
	save: async ({ request, locals, platform, params, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const env = platform!.env;
		const db = getDb(env.DB);
		const form = await request.formData();
		const units = memberUnits(cookies);

		const fields = await loadFields(db);
		const { values, problems } = parseEntryForm(fields, form, units);
		if (!problems.length && !Object.keys(values).length) {
			problems.push('Nothing to save - fill in at least one field, or delete the entry.');
		}
		if (problems.length) return fail(400, { problems, raw: rawEcho(form) });

		computeBmi(fields, values);
		const ok = await editEntry(
			db,
			locals.member.memberId,
			params.id,
			values,
			today((await loadSettings(db)).timezone)
		);
		if (!ok) error(404, 'Not found');
		redirect(303, '/home');
	},

	delete: async ({ locals, platform, params }) => {
		if (!locals.member) redirect(303, '/');
		const db = getDb(platform!.env.DB);
		const ok = await deleteEntry(
			db,
			locals.member.memberId,
			params.id,
			today((await loadSettings(db)).timezone)
		);
		if (!ok) error(404, 'Not found');
		redirect(303, '/home');
	}
};
