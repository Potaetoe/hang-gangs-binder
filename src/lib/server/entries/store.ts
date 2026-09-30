import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Entry, EntryValue, NewValues, Writes } from '../db';
import * as table from '../db/schema';
import { runBatch } from '../db';
import { randomToken } from '../crypto';
import type { HistoryValues } from '../fields';

const rowsOf = (entryId: string, values: NewValues) =>
	Object.entries(values).map(([fieldId, v]) => ({ entryId, fieldId, ...v }));

/** The entry and its values land together or not at all. Two saves
 * racing for one seq trip the unique index, and one of them fails:
 * better a refused double tap than two entries in one slot. */
export async function createEntry(
	db: Db,
	memberId: string,
	date: string,
	values: NewValues
): Promise<string> {
	const id = randomToken(16);
	const [{ maxSeq }] = await db
		.select({ maxSeq: sql<number>`coalesce(max(${table.entries.seq}), 0)` })
		.from(table.entries)
		.where(eq(table.entries.memberId, memberId));
	const statements: Writes = [
		db.insert(table.entries).values({ id, memberId, date, seq: maxSeq + 1 })
	];
	const rows = rowsOf(id, values);
	if (rows.length) statements.push(db.insert(table.entryValues).values(rows));
	await runBatch(db, statements);
	return id;
}

/** The member's own entry, or null. Someone else's id reads the same as
 * a missing one. */
export async function memberEntry(db: Db, memberId: string, entryId: string) {
	const [entry] = await db
		.select()
		.from(table.entries)
		.where(and(eq(table.entries.id, entryId), eq(table.entries.memberId, memberId)));
	if (!entry) return null;
	const values = await db
		.select()
		.from(table.entryValues)
		.where(eq(table.entryValues.entryId, entryId));
	return { entry, values };
}

/** The before-image, as a statement that shares a batch with the change
 * it records. */
function auditQuery(
	db: Db,
	action: 'edit' | 'delete',
	entry: Entry,
	values: EntryValue[],
	auditDate: string
) {
	const before = Object.fromEntries(
		values.map(({ fieldId, metric, imperial, entered, choice }) => [
			fieldId,
			{ metric, imperial, entered, choice }
		])
	);
	return db.insert(table.memberAudit).values({
		id: randomToken(16),
		memberId: entry.memberId,
		date: auditDate,
		action,
		entryId: entry.id,
		entryDate: entry.date,
		before: JSON.stringify(before)
	});
}

/** Corrections change the numbers, never the date. Audit, wipe and
 * rewrite are one batch, so dying halfway cannot leave an empty entry. */
export async function editEntry(
	db: Db,
	current: HistoryEntry,
	values: NewValues,
	auditDate: string
) {
	const entryId = current.entry.id;
	const statements: Writes = [
		auditQuery(db, 'edit', current.entry, current.values, auditDate),
		db.delete(table.entryValues).where(eq(table.entryValues.entryId, entryId))
	];
	const rows = rowsOf(entryId, values);
	if (rows.length) statements.push(db.insert(table.entryValues).values(rows));
	await runBatch(db, statements);
}

export async function deleteEntry(
	db: Db,
	memberId: string,
	entryId: string,
	auditDate: string
): Promise<boolean> {
	const found = await memberEntry(db, memberId, entryId);
	if (!found) return false;
	await runBatch(db, [
		auditQuery(db, 'delete', found.entry, found.values, auditDate),
		db.delete(table.entryValues).where(eq(table.entryValues.entryId, entryId)),
		db.delete(table.entries).where(eq(table.entries.id, entryId))
	]);
	return true;
}

export type HistoryEntry = { entry: Entry; values: EntryValue[] };

/** Newest first. One extra row is fetched so the page knows an older
 * page exists without a count query. */
export async function memberHistory(
	db: Db,
	memberId: string,
	page: number,
	pageSize: number
): Promise<{ entries: HistoryEntry[]; hasOlder: boolean }> {
	const rows = await db
		.select()
		.from(table.entries)
		.where(eq(table.entries.memberId, memberId))
		.orderBy(desc(table.entries.date), desc(table.entries.seq))
		.limit(pageSize + 1)
		.offset((page - 1) * pageSize);
	const entries = rows.slice(0, pageSize);
	if (!entries.length) return { entries: [], hasOlder: false };
	const values = await db
		.select()
		.from(table.entryValues)
		.where(
			inArray(
				table.entryValues.entryId,
				entries.map((e) => e.id)
			)
		);
	return {
		entries: entries.map((entry) => ({
			entry,
			values: values.filter((v) => v.entryId === entry.id)
		})),
		hasOlder: rows.length > pageSize
	};
}

/** Every value the member ever stored, oldest entry first. */
export async function valuesOldestFirst(db: Db, memberId: string) {
	return db
		.select({ value: table.entryValues, date: table.entries.date, seq: table.entries.seq })
		.from(table.entryValues)
		.innerJoin(table.entries, eq(table.entryValues.entryId, table.entries.id))
		.where(eq(table.entries.memberId, memberId))
		.orderBy(asc(table.entries.date), asc(table.entries.seq));
}

/**
 * Each field's first stored value, and its latest before `before` (an
 * entry being edited). With no `before`, "previous" is simply the
 * member's latest value, which is also what pre-fills the form.
 */
export async function historyFor(
	db: Db,
	memberId: string,
	before?: { date: string; seq: number }
): Promise<HistoryValues> {
	const first: Record<string, EntryValue> = {};
	const prev: Record<string, EntryValue> = {};
	for (const row of await valuesOldestFirst(db, memberId)) {
		const earlier =
			!before || row.date < before.date || (row.date === before.date && row.seq < before.seq);
		if (!earlier) continue;
		first[row.value.fieldId] ??= row.value;
		prev[row.value.fieldId] = row.value;
	}
	return { first, prev };
}
