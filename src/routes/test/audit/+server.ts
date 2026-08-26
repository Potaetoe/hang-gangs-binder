import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { logins, memberAudit } from '$lib/server/db/schema';
import { hmacHex } from '$lib/server/crypto';
import { requireTestHooks } from '$lib/server/test-hooks';

/**
 * TEST HOOK, absent from production: a plain build tree-shakes the
 * handler away (`__TEST_HOOKS__`, vite.config.ts) and only the 404
 * below remains; in test builds the runtime TEST_HOOKS guard still
 * gates it. Lets the e2e loop assert a member's correction trail
 * without parsing the admin page.
 */
async function readAudit({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);

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

export const GET = __TEST_HOOKS__ ? readAudit : () => error(404, 'Not found');
