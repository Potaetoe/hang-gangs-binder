import { desc, sql } from 'drizzle-orm';
import type { Db } from './db';
import * as table from './db/schema';
import { randomToken } from './crypto';
import { allIdentities, nameOf } from './identity';

/*
 * The admin change log: every admin action, from any feature, writes a
 * line here (DESIGN.md, "Admin surface").
 */

/** The log line as an unexecuted statement, so an action and its line
 * land in one batch. An action without its line, or a line without its
 * action, is a record that lies. */
export function logAdminQuery(
	db: Db,
	date: string,
	actorId: string,
	action: string,
	subjectId: string | null = null,
	detail: string | null = null
) {
	return db
		.insert(table.adminLog)
		.values({ id: randomToken(16), date, actorId, action, subjectId, detail });
}

export async function logAdmin(...args: Parameters<typeof logAdminQuery>) {
	await logAdminQuery(...args);
}

export type LogLine = {
	date: string;
	actor: string;
	action: string;
	subject: string | null;
	detail: string | null;
};

export async function readLog(
	db: Db,
	env: Pick<Env, 'DIRECTORY_SECRET'>,
	limit = 100
): Promise<LogLine[]> {
	const rows = await db
		.select()
		.from(table.adminLog)
		// Ids are random, so rowid is what keeps same-day lines in order.
		.orderBy(desc(table.adminLog.date), desc(sql`rowid`))
		.limit(limit);
	const identities = await allIdentities(db, env);
	const who = (id: string | null) =>
		id ? nameOf(identities.get(id)) || 'a departed member' : null;
	return rows.map((row) => ({
		date: row.date,
		actor: who(row.actorId) ?? 'unknown',
		action: row.action,
		subject: who(row.subjectId),
		detail: row.detail
	}));
}
