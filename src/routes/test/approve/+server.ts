import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins, members } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';

/**
 * TEST HOOK, dead in production: exists only when TEST_HOOKS="1" is in
 * the environment, which .dev.vars sets locally and nothing sets on a
 * deployment. The e2e approval loop needs a way to play the admin
 * before the admin surface exists; once that surface ships, this file
 * goes with it.
 */
export async function POST({ url, platform }: RequestEvent) {
	const env = platform!.env;
	if (env.TEST_HOOKS !== '1') error(404, 'Not found');

	const username = url.searchParams.get('username')?.toLowerCase() ?? '';
	const db = getDb(env.DB);
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username}`);
	const login = (await db.select().from(logins).where(eq(logins.lookupHash, lookupHash)))[0];
	if (!login) error(404, 'No such registration');
	await db
		.update(members)
		.set({ status: 'approved' })
		.where(eq(members.id, login.memberId));
	return json({ ok: true });
}
