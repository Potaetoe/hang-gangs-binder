import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins, members } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';
import { requireTestHooks } from '$lib/server/test-hooks';

/**
 * TEST HOOK, absent from production: a plain build tree-shakes the
 * handler away (`__TEST_HOOKS__`, vite.config.ts) and only the 404
 * below remains; in test builds the runtime TEST_HOOKS guard still
 * gates it. Makes a password account an approved admin, so the e2e
 * suite can play the operator's one manual bootstrap step.
 */
async function makeAdmin({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);

	const username = url.searchParams.get('username')?.toLowerCase() ?? '';
	const db = getDb(env.DB);
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username}`);
	const login = (await db.select().from(logins).where(eq(logins.lookupHash, lookupHash)))[0];
	if (!login) error(404, 'No such registration');
	await db
		.update(members)
		.set({ status: 'approved', isAdmin: true })
		.where(eq(members.id, login.memberId));
	return json({ ok: true });
}

export const POST = __TEST_HOOKS__ ? makeAdmin : () => error(404, 'Not found');
