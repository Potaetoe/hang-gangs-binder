import { error, json, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { members } from '$lib/server/db/schema';
import { memberIdByUsername, requireTestHooks } from '$lib/server/test-hooks';

/** Test hook: approves a registration without going through the admin pages. */
async function approve({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);
	const db = getDb(env.DB);
	const id = await memberIdByUsername(db, env, url.searchParams.get('username') ?? '');
	await db.update(members).set({ status: 'approved' }).where(eq(members.id, id));
	return json({ ok: true });
}

export const POST = __TEST_HOOKS__ ? approve : () => error(404, 'Not found');
