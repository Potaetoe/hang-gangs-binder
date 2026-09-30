import { error, json, type RequestEvent } from '@sveltejs/kit';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireTestHooks } from '$lib/server/test-hooks';

/**
 * Test hook: counts every row still tied to a member id, so the purge
 * test can prove the cleanup left nothing. A purge that only looked
 * complete is the worst failure this app could have.
 */
async function countLeftovers({ url, platform }: RequestEvent) {
	const env = platform!.env;
	requireTestHooks(env);
	const id = url.searchParams.get('id') ?? '';
	if (!id) error(400, 'Which member?');
	const db = getDb(env.DB);
	const count = async (from: SQLiteTable, where: SQL) => {
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(from)
			.where(where);
		return row?.n ?? 0;
	};
	return json({
		members: await count(table.members, eq(table.members.id, id)),
		logins: await count(table.logins, eq(table.logins.memberId, id)),
		directory: await count(table.directory, eq(table.directory.memberId, id)),
		socials: await count(table.socials, eq(table.socials.memberId, id)),
		sessions: await count(table.sessions, eq(table.sessions.memberId, id)),
		entries: await count(table.entries, eq(table.entries.memberId, id)),
		memberAudit: await count(table.memberAudit, eq(table.memberAudit.memberId, id)),
		rsvps: await count(table.eventRsvps, eq(table.eventRsvps.memberId, id)),
		// With the entries gone nothing says whose values these were, so the
		// honest check is global: no value may be left without its entry.
		orphanValues: await count(
			table.entryValues,
			sql`${table.entryValues.entryId} NOT IN (SELECT ${table.entries.id} FROM ${table.entries})`
		)
	});
}

export const GET = __TEST_HOOKS__ ? countLeftovers : () => error(404, 'Not found');
