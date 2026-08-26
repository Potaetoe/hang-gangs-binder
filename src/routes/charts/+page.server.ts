import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { boardTiles, latestPerMember, memberTotal, weeklyAverages } from '$lib/server/charts';
import { loadFields, memberUnits } from '$lib/server/stats';
import { loadSettings, trendSet } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	// Two bounded queries instead of the whole history (hardening
	// pass, 2026-08-26): the board stays the same size however many
	// entries the group stacks up.
	const latest = await latestPerMember(db);
	const weekly = await weeklyAverages(db);
	// Trend lines only on the admin-chosen fields (owner ruling
	// 2026-08-26); the tile and its headline stay either way.
	const chosen = trendSet(await loadSettings(db));
	return {
		units,
		members: await memberTotal(db),
		tiles: boardTiles(latest, weekly, fields, units).map((tile) =>
			chosen.has(tile.id) ? tile : { ...tile, poly: null }
		)
	};
};
