import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { focusView, loadGroup, readFilters } from '$lib/server/charts';
import { loadFields, type Units } from '$lib/server/stats';

const unitsOf = (cookie: string | undefined): Units =>
	cookie === 'metric' ? 'metric' : 'imperial';

export const load: PageServerLoad = async ({ locals, platform, params, url, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = unitsOf(cookies.get('units'));
	const fields = await loadFields(db);
	const field = fields.find((f) => f.id === params.field);
	if (!field) error(404, 'Not found');
	const group = await loadGroup(db);
	const filters = readFilters(fields, url.searchParams);
	return {
		units,
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
		cookies.set('units', choice, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 400 * 86_400
		});
		// Back to the same field and filters; only same-site paths.
		const back = String(form.get('back') ?? '/charts');
		redirect(303, back.startsWith('/') && !back.startsWith('//') ? back : '/charts');
	}
};
