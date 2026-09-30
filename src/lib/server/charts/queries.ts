import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, EntryValue } from '../db';
import * as table from '../db/schema';

export type GroupEntry = { date: string; seq: number; values: Map<string, EntryValue> };
/** memberId -> entries, oldest first. */
export type Group = Map<string, GroupEntry[]>;

/**
 * The group's entries carrying only the named fields. Loading every
 * value of every entry blew the free plan's CPU budget at a hundred
 * members. A focused chart only reads its own field and the filters, and
 * an entry holding none of them could change no answer.
 */
export async function loadGroupFor(db: Db, fieldIds: string[]): Promise<Group> {
	if (!fieldIds.length) return new Map();
	const rows = await db
		.select({
			entryId: table.entries.id,
			memberId: table.entries.memberId,
			date: table.entries.date,
			seq: table.entries.seq,
			value: table.entryValues
		})
		.from(table.entryValues)
		.innerJoin(table.entries, eq(table.entryValues.entryId, table.entries.id))
		.where(inArray(table.entryValues.fieldId, fieldIds))
		.orderBy(asc(table.entries.date), asc(table.entries.seq));
	const group: Group = new Map();
	const byEntry = new Map<string, GroupEntry>();
	for (const row of rows) {
		let entry = byEntry.get(row.entryId);
		if (!entry) {
			entry = { date: row.date, seq: row.seq, values: new Map() };
			byEntry.set(row.entryId, entry);
			const list = group.get(row.memberId) ?? [];
			list.push(entry);
			group.set(row.memberId, list);
		}
		entry.values.set(row.value.fieldId, row.value);
	}
	return group;
}

/** How many members have any entry: the "of N" the pages show. */
export async function memberTotal(db: Db): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(distinct ${table.entries.memberId})` })
		.from(table.entries);
	return row?.n ?? 0;
}

export type LatestRow = {
	fieldId: string;
	memberId: string;
	metric: number | null;
	imperial: number | null;
	choice: string | null;
};

/** Each member's newest value of each field, in one query bounded by
 * members × fields however long the history grows. */
export async function latestPerMember(db: Db): Promise<LatestRow[]> {
	const rows = await db.all<{
		field_id: string;
		member_id: string;
		metric: number | null;
		imperial: number | null;
		choice: string | null;
	}>(sql`
		SELECT field_id, member_id, metric, imperial, choice FROM (
			SELECT ev.field_id, e.member_id, ev.metric, ev.imperial, ev.choice,
				ROW_NUMBER() OVER (
					PARTITION BY ev.field_id, e.member_id
					ORDER BY e.date DESC, e.seq DESC
				) AS rn
			FROM entry_values ev JOIN entries e ON e.id = ev.entry_id
		) WHERE rn = 1
	`);
	return rows.map((r) => ({
		fieldId: r.field_id,
		memberId: r.member_id,
		metric: r.metric,
		imperial: r.imperial,
		choice: r.choice
	}));
}

export type WeekPoint = { week: number; metric: number; imperial: number };

/**
 * Weekly group averages per number field, worked out in the database.
 * Each member counts once a week, by their last value that week, so a
 * busy member does not outweigh a quiet one. `unixepoch()/86400/7` is
 * integer division, matching weekOf() in focus.ts.
 */
export async function weeklyAverages(db: Db): Promise<Map<string, WeekPoint[]>> {
	const rows = await db.all<{ field_id: string; week: number; am: number; ai: number }>(sql`
		SELECT field_id, week, AVG(metric) AS am, AVG(imperial) AS ai FROM (
			SELECT ev.field_id, ev.metric, ev.imperial,
				unixepoch(e.date) / 86400 / 7 AS week,
				ROW_NUMBER() OVER (
					PARTITION BY ev.field_id, e.member_id, unixepoch(e.date) / 86400 / 7
					ORDER BY e.date DESC, e.seq DESC
				) AS rn
			FROM entry_values ev JOIN entries e ON e.id = ev.entry_id
			WHERE ev.metric IS NOT NULL
		) WHERE rn = 1
		GROUP BY field_id, week
		ORDER BY field_id, week
	`);
	const out = new Map<string, WeekPoint[]>();
	for (const row of rows) {
		const list = out.get(row.field_id) ?? [];
		list.push({ week: row.week, metric: row.am, imperial: row.ai });
		out.set(row.field_id, list);
	}
	return out;
}
