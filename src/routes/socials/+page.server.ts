import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import type { Secrets } from '$lib/server/auth';
import { hasSocials, socialsRoster } from '$lib/server/socials';
import { renderMessage, socialsMessageOf } from '$lib/server/rich';
import { loadSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.member) redirect(303, '/');
	const env = platform!.env;
	const db = getDb(env.DB);
	const settings = await loadSettings(db);
	return {
		// The group's panel (owner rulings 2026-09-30): admin HTML,
		// cleaned again here on the way out.
		message: renderMessage(socialsMessageOf(settings)),
		roster: await socialsRoster(db, env as unknown as Secrets),
		// The nudge shows until the viewer has links of their own
		// (owner ruling 2026-08-26).
		mineMissing: !(await hasSocials(db, locals.member.memberId))
	};
};
