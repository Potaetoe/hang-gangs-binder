import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import type { Secrets } from '$lib/server/auth';
import { hasSocials, parseOfficialLinks, socialsRoster } from '$lib/server/socials';
import { loadSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.member) redirect(303, '/');
	const env = platform!.env;
	const db = getDb(env.DB);
	const settings = await loadSettings(db);
	return {
		official: parseOfficialLinks(settings.socialLinks),
		roster: await socialsRoster(db, env as unknown as Secrets),
		// The nudge shows until the viewer has links of their own
		// (owner ruling 2026-08-26).
		mineMissing: !(await hasSocials(db, locals.member.memberId))
	};
};
