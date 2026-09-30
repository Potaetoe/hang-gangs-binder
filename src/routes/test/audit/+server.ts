import { error, json, type RequestEvent } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { memberAudit } from '$lib/server/db/schema';
import { memberIdByUsername, requireTestHooks } from '$lib/server/test-hooks';

/** Test hook: a member's correction trail, without parsing admin pages.
 * Same-day rows carry no clock by design, so their order means nothing. */
async function readAudit({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);
	const db = getDb(env.DB);
	const id = await memberIdByUsername(db, env, url.searchParams.get('username') ?? '');
	const rows = await db
		.select({ action: memberAudit.action, entryDate: memberAudit.entryDate })
		.from(memberAudit)
		.where(eq(memberAudit.memberId, id))
		.orderBy(asc(memberAudit.date));
	return json(rows);
}

export const GET = __TEST_HOOKS__ ? readAudit : () => error(404, 'Not found');
