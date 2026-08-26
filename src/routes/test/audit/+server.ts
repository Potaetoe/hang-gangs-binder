import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins, memberAudit } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';

/**
 * TEST HOOK, dead in production (TEST_HOOKS is only set in .dev.vars,
 * like /test/approve): lets the e2e loop assert a member's correction
 * trail without parsing the admin page. The admin surface ships its
 * own corrections view now; this stays because the loop test reads
 * the trail as data (comment corrected on the hardening pass,
 * 2026-08-26 - it used to promise its own deletion).
 */
export async function GET({ url, platform }: RequestEvent) {
	const env = platform!.env;
	if (env.TEST_HOOKS !== '1') error(404, 'Not found');

	const username = url.searchParams.get('username')?.toLowerCase() ?? '';
	const db = getDb(env.DB);
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username}`);
	const login = (await db.select().from(logins).where(eq(logins.lookupHash, lookupHash)))[0];
	if (!login) error(404, 'No such registration');
	// Date is the only order the trail has: same-day rows carry no
	// clock on purpose (the no-timestamp privacy rule), so callers
	// must not read meaning into their order.
	const rows = await db
		.select({ action: memberAudit.action, entryDate: memberAudit.entryDate })
		.from(memberAudit)
		.where(eq(memberAudit.memberId, login.memberId))
		.orderBy(asc(memberAudit.date));
	return json(rows);
}
