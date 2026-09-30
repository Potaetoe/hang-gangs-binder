import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { focusView, loadGroupFor, memberTotal, readFilters } from '$lib/server/charts';
import { loadFields } from '$lib/server/fields';
import { loadSettings, trendSet } from '$lib/server/settings';
import { memberUnits } from '$lib/server/units';

export const load: PageServerLoad = async ({ locals, platform, params, url, cookies }) => {
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies, url);
	const fields = await loadFields(db);
	const field = fields.find((f) => f.id === params.field);
	if (!field) error(404, 'Not found');
	const filters = readFilters(fields, url.searchParams);
	const [group, total, settings] = await Promise.all([
		loadGroupFor(db, [field.id, ...Object.keys(filters)]),
		memberTotal(db),
		loadSettings(db)
	]);
	return {
		units,
		// Units change nothing on a choice or unitless chart, so the toggle
		// only shows where they matter.
		hasUnits: field.measure === 'length' || field.measure === 'mass',
		fieldId: field.id,
		fieldList: fields.map((f) => ({ id: f.id, name: f.name })),
		focus: focusView(
			group,
			fields,
			field,
			filters,
			units,
			locals.member!.memberId,
			total,
			trendSet(settings).has(field.id)
		)
	};
};
