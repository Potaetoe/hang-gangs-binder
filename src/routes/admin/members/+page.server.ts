import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { memberRoster } from '$lib/server/admin';
import type { Secrets } from '$lib/server/auth';

export const load: PageServerLoad = async ({ platform }) => {
	const env = platform!.env;
	return { roster: await memberRoster(getDb(env.DB), env as unknown as Secrets) };
};
