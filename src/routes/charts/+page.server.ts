import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { boardTiles, loadGroup } from '$lib/server/charts';
import { loadFields, memberUnits } from '$lib/server/stats';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	const group = await loadGroup(db);
	return {
		units,
		members: group.size,
		tiles: boardTiles(group, fields, units)
	};
};
