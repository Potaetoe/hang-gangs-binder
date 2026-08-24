import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins, memberAudit } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';

/**
 * TEST HOOK, dead in production (TEST_HOOKS is only set in .dev.vars,
 * like /test/approve): lets the e2e loop see a member's correction
 * audit before the admin review surface (build order step 4) exists.
 * Once that surface ships, this file goes with it.
 */
export async function GET({ url, platform }: RequestEvent) {
	const env = platform!.env;
	if (env.TEST_HOOKS !== '1') error(404, 'Not found');

	const username = url.searchParams.get('username')?.toLowerCase() ?? '';
	const db = getDb(env.DB);
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username}`);
	const login = (await db.select().from(logins).where(eq(logins.lookupHash, lookupHash)))[0];
	if (!login) error(404, 'No such registration');
	const rows = await db
		.select({ action: memberAudit.action, entryDate: memberAudit.entryDate })
		.from(memberAudit)
		.where(eq(memberAudit.memberId, login.memberId))
		.orderBy(asc(memberAudit.id));
	return json(rows);
}
