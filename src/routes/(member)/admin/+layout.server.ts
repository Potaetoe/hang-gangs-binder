import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { pendingCount } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ platform }) => ({
	pendingCount: await pendingCount(getDb(platform!.env.DB))
});
