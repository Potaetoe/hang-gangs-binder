import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';

/**
 * TEST HOOK, dead in production (TEST_HOOKS is only set in .dev.vars,
 * like /test/approve): hands the purge test a member's opaque id
 * while the account still exists - after the purge there is no way to
 * look it up, which is the point of the purge.
 */
export async function GET({ url, platform }: RequestEvent) {
	const env = platform!.env;
	if (env.TEST_HOOKS !== '1') error(404, 'Not found');

	const username = url.searchParams.get('username')?.toLowerCase() ?? '';
	const db = getDb(env.DB);
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username}`);
	const login = (await db.select().from(logins).where(eq(logins.lookupHash, lookupHash)))[0];
	if (!login) error(404, 'No such registration');
	return json({ id: login.memberId });
}
