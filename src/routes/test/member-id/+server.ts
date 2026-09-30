import { error, json, type RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { memberIdByUsername, requireTestHooks } from '$lib/server/test-hooks';

/** Test hook: a member's opaque id while the account exists. After a
 * purge there is no way to look it up, which is the point of the purge. */
async function memberId({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);
	const id = await memberIdByUsername(getDb(env.DB), env, url.searchParams.get('username') ?? '');
	return json({ id });
}

export const GET = __TEST_HOOKS__ ? memberId : () => error(404, 'Not found');
