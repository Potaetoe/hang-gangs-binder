import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { readCorrections } from '$lib/server/admin';
import { loadFields } from '$lib/server/fields';
import { memberUnits } from '$lib/server/units';

export const load: PageServerLoad = async ({ platform, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	return { lines: await readCorrections(db, env, await loadFields(db), memberUnits(cookies)) };
};
