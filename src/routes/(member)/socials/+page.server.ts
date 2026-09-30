import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasSocials, renderMessage, socialsMessageOf, socialsRoster } from '$lib/server/socials';
import { loadSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	return {
		message: renderMessage(socialsMessageOf(await loadSettings(db))),
		roster: await socialsRoster(db, env),
		mineMissing: !(await hasSocials(db, locals.member!.memberId))
	};
};
