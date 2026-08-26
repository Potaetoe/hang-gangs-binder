import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from './schema';

export const getDb = (d1: D1Database) => drizzle(d1, { schema });

/** Unexecuted statements headed for one atomic batch. */
export type Writes = BatchItem<'sqlite'>[];

/**
 * Every multi-statement mutation goes through here (hardening pass,
 * 2026-08-26). D1 runs a batch as one transaction: all of it lands or
 * none of it does. Before this, a purge or an entry edit was a row of
 * separate writes, and a failure in the middle left half a change
 * behind.
 */
export async function runBatch(
	db: DrizzleD1Database<typeof schema>,
	statements: Writes
): Promise<void> {
	if (!statements.length) return;
	await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}
