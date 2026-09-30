import { error, json, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { members } from '$lib/server/db/schema';
import { memberIdByUsername, requireTestHooks } from '$lib/server/test-hooks';

/** Test hook: makes a registration an approved admin, standing in for
 * the operator's one manual bootstrap step. */
async function makeAdmin({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);
	const db = getDb(env.DB);
	const id = await memberIdByUsername(db, env, url.searchParams.get('username') ?? '');
	await db.update(members).set({ status: 'approved', isAdmin: true }).where(eq(members.id, id));
	return json({ ok: true });
}

export const POST = __TEST_HOOKS__ ? makeAdmin : () => error(404, 'Not found');
