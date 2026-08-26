import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { focusView, loadGroup, readFilters } from '$lib/server/charts';
import { loadFields, memberUnits } from '$lib/server/stats';
import { loadSettings, trendSet } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, platform, params, url, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies, url);
	const fields = await loadFields(db);
	const field = fields.find((f) => f.id === params.field);
	if (!field) error(404, 'Not found');
	const group = await loadGroup(db);
	const filters = readFilters(fields, url.searchParams);
	const focus = focusView(group, fields, field, filters, units, locals.member.memberId);
	// Trend lines only on the admin-chosen fields (owner ruling
	// 2026-08-26); the stats and distribution stay.
	if (!trendSet(await loadSettings(db)).has(field.id)) focus.trend = null;
	return {
		units,
		// Units mean nothing on a choice or unitless chart (owner,
		// 2026-08-24) - the toggle only shows where they change it.
		hasUnits: field.type === 'number' && (field.measure === 'length' || field.measure === 'mass'),
		fieldId: field.id,
		fieldList: fields.map((f) => ({ id: f.id, name: f.name })),
		focus,
		query: url.search
	};
};
