import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { boardTiles, latestPerMember, memberTotal, weeklyAverages } from '$lib/server/charts';
import { loadFields } from '$lib/server/fields';
import { loadSettings, trendSet } from '$lib/server/settings';
import { memberUnits } from '$lib/server/units';

export const load: PageServerLoad = async ({ platform, cookies }) => {
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies);
	const [fields, latest, weekly, members, settings] = await Promise.all([
		loadFields(db),
		latestPerMember(db),
		weeklyAverages(db),
		memberTotal(db),
		loadSettings(db)
	]);
	return {
		units,
		members,
		tiles: boardTiles(latest, weekly, fields, units, trendSet(settings))
	};
};
