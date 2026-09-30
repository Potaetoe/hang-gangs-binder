import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import * as schema from './schema';

export type Db = DrizzleD1Database<typeof schema>;

export type Field = typeof schema.fields.$inferSelect;
export type Entry = typeof schema.entries.$inferSelect;
export type EntryValue = typeof schema.entryValues.$inferSelect;
/** An entry's values before they are stored, keyed by field id. */
export type NewValues = Record<string, Omit<EntryValue, 'entryId' | 'fieldId'>>;
export type EventRow = typeof schema.events.$inferSelect;
export type EventImageRow = typeof schema.eventImages.$inferSelect;

export const getDb = (d1: D1Database): Db => drizzle(d1, { schema });

/** Unexecuted statements headed for one batch. */
export type Writes = BatchItem<'sqlite'>[];

/**
 * D1 runs a batch as one transaction. Any change that touches more than
 * one row goes through here, so a failure halfway can never leave half
 * a change behind.
 */
export async function runBatch(db: Db, statements: Writes): Promise<void> {
	if (!statements.length) return;
	await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}
