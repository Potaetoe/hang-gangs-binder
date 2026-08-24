import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { boardTiles, loadGroup } from '$lib/server/charts';
import { loadFields, type Units } from '$lib/server/stats';

const unitsOf = (cookie: string | undefined): Units =>
	cookie === 'metric' ? 'metric' : 'imperial';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = unitsOf(cookies.get('units'));
	const fields = await loadFields(db);
	const group = await loadGroup(db);
	return {
		units,
		members: group.size,
		tiles: boardTiles(group, fields, units)
	};
};
