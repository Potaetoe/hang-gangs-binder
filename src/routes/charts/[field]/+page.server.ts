import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { focusView, loadGroup, readFilters } from '$lib/server/charts';
import { loadFields, memberUnits } from '$lib/server/stats';

export const load: PageServerLoad = async ({ locals, platform, params, url, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	const field = fields.find((f) => f.id === params.field);
	if (!field) error(404, 'Not found');
	const group = await loadGroup(db);
	const filters = readFilters(fields, url.searchParams);
	return {
		units,
		// Units mean nothing on a choice or unitless chart (owner,
		// 2026-08-24) - the toggle only shows where they change it.
		hasUnits: field.type === 'number' && (field.measure === 'length' || field.measure === 'mass'),
		fieldId: field.id,
		fieldList: fields.map((f) => ({ id: f.id, name: f.name })),
		focus: focusView(group, fields, field, filters, units, locals.member.memberId),
		query: url.search
	};
};

export const actions: Actions = {
	units: async ({ request, cookies, locals }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		const choice = form.get('units') === 'metric' ? 'metric' : 'imperial';
		// A session-long view, not the default - Settings owns that
		// (owner ruling 2026-08-26). No maxAge: it dies with the browser.
		cookies.set('units_view', choice, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true
		});
		// Back to the same field and filters; only same-site paths.
		const back = String(form.get('back') ?? '/charts');
		redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/charts');
	}
};
