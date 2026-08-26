import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

/**
 * TEST HOOK, dead in production (TEST_HOOKS is only set in .dev.vars,
 * like /test/approve): counts every row still tied to a member id, so
 * the purge test can prove the departed cleanup left NOTHING - the
 * worst failure this app could have is a purge that only looked
 * complete.
 */
export async function GET({ url, platform }: RequestEvent) {
	const env = platform!.env;
	if (env.TEST_HOOKS !== '1') error(404, 'Not found');

	const id = url.searchParams.get('id') ?? '';
	if (!id) error(400, 'Which member?');
	const db = getDb(env.DB);
	const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
	const counts = {
		members: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.members)
				.where(eq(table.members.id, id))
		),
		logins: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.logins)
				.where(eq(table.logins.memberId, id))
		),
		directory: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.directory)
				.where(eq(table.directory.memberId, id))
		),
		socials: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.socials)
				.where(eq(table.socials.memberId, id))
		),
		sessions: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.sessions)
				.where(eq(table.sessions.memberId, id))
		),
		entries: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.entries)
				.where(eq(table.entries.memberId, id))
		),
		// Once the entries are gone their id cannot say whose values these
		// were - so the honest check is global: a purge that left values
		// behind leaves them orphaned, and orphans must not exist.
		orphanValues: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.entryValues)
				.leftJoin(table.entries, eq(table.entryValues.entryId, table.entries.id))
				.where(sql`${table.entries.id} IS NULL`)
		),
		memberAudit: await count(
			db
				.select({ n: sql<number>`count(*)` })
				.from(table.memberAudit)
				.where(eq(table.memberAudit.memberId, id))
		)
	};
	return json(counts);
}
