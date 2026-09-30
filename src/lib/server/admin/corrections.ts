import { desc, eq, sql } from 'drizzle-orm';
import type { Db, EntryValue, Field } from '../db';
import * as table from '../db/schema';
import { allIdentities, nameOf } from '../identity';
import { formatValue } from '../fields';
import type { Units } from '../units';

/** The before-image as one readable line, in the viewer's units. */
function describeBefore(before: string, fields: Field[], units: Units): string {
	try {
		const parsed = JSON.parse(before) as Record<string, EntryValue>;
		return fields
			.map((field) => (parsed[field.id] ? formatValue(field, parsed[field.id], units) : ''))
			.filter(Boolean)
			.join(' · ');
	} catch {
		return '';
	}
}

export type CorrectionLine = {
	date: string;
	member: string;
	action: 'edit' | 'delete';
	entryDate: string;
	before: string;
};

/** Every member edit and delete, newest first, kept apart from the
 * admin change log. */
export async function readCorrections(
	db: Db,
	env: Pick<Env, 'DIRECTORY_SECRET'>,
	fields: Field[],
	units: Units,
	limit = 100
): Promise<CorrectionLine[]> {
	const rows = await db
		.select()
		.from(table.memberAudit)
		.orderBy(desc(table.memberAudit.date), desc(sql`rowid`))
		.limit(limit);
	const identities = await allIdentities(db, env);
	return rows.map((row) => ({
		date: row.date,
		member: nameOf(identities.get(row.memberId)) || 'a departed member',
		action: row.action,
		entryDate: row.entryDate,
		before: describeBefore(row.before, fields, units)
	}));
}

/** One member's trail, for their admin page. */
export async function correctionsOf(db: Db, memberId: string) {
	return db
		.select({
			date: table.memberAudit.date,
			action: table.memberAudit.action,
			entryDate: table.memberAudit.entryDate
		})
		.from(table.memberAudit)
		.where(eq(table.memberAudit.memberId, memberId))
		.orderBy(desc(table.memberAudit.date), desc(sql`rowid`));
}
