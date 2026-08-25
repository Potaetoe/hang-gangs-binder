/**
 * The admin surface's machinery (DESIGN.md "Admin surface"; owner
 * rulings 2026-08-24): approvals, the member roster with unsealed
 * names, roles, temporary passphrases, the full purge, and the change
 * log every action writes to. Admins see everything about a member -
 * that was the ruling - but plain identities still live ONLY in the
 * sealed directory: these functions unseal for display and never
 * write a name anywhere else.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import { identityOf, PASSWORD_MAX, PASSWORD_MIN, type Identity, type Secrets } from './auth';
import { hashPassword, randomToken } from './crypto';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

/* ---------------------------------------------------------------- */
/* The change log                                                    */

export async function logAdmin(
	db: Db,
	date: string,
	actorId: string,
	action: string,
	subjectId: string | null = null,
	detail: string | null = null
) {
	await db.insert(table.adminLog).values({
		id: randomToken(16),
		date,
		actorId,
		action,
		subjectId,
		detail
	});
}

const displayName = (identity: Identity): string =>
	identity.displayName || identity.handle || identity.username || '';

export type LogLine = {
	date: string;
	actor: string;
	action: string;
	subject: string | null;
	detail: string | null;
};

export async function readLog(db: Db, secrets: Secrets, limit = 100): Promise<LogLine[]> {
	const rows = await db
		.select()
		.from(table.adminLog)
		// Ids are random, so within a day they'd shuffle; rowid keeps
		// same-day lines in the order they happened, newest first.
		.orderBy(desc(table.adminLog.date), desc(sql`rowid`))
		.limit(limit);
	const names = new Map<string, string>();
	const nameOf = async (id: string | null): Promise<string | null> => {
		if (!id) return null;
		if (!names.has(id)) {
			names.set(id, displayName(await identityOf(db, secrets, id)) || 'a departed member');
		}
		return names.get(id)!;
	};
	const out: LogLine[] = [];
	for (const row of rows) {
		out.push({
			date: row.date,
			actor: (await nameOf(row.actorId)) ?? 'unknown',
			action: row.action,
			subject: await nameOf(row.subjectId),
			detail: row.detail
		});
	}
	return out;
}

/* ---------------------------------------------------------------- */
/* The roster                                                        */

export type MemberRow = {
	id: string;
	name: string;
	username: string | null;
	handle: string | null;
	doors: string;
	status: 'pending' | 'approved';
	isAdmin: boolean;
	entryCount: number;
	lastEntry: string | null;
};

export async function memberRoster(db: Db, secrets: Secrets): Promise<MemberRow[]> {
	const members = await db.select().from(table.members);
	const logins = await db.select().from(table.logins);
	const entries = await db
		.select({ memberId: table.entries.memberId, date: table.entries.date })
		.from(table.entries);

	const stats = new Map<string, { count: number; last: string }>();
	for (const entry of entries) {
		const s = stats.get(entry.memberId) ?? { count: 0, last: '' };
		s.count += 1;
		if (entry.date > s.last) s.last = entry.date;
		stats.set(entry.memberId, s);
	}
	const doorsOf = new Map<string, string[]>();
	for (const login of logins) {
		const list = doorsOf.get(login.memberId) ?? [];
		list.push(login.kind);
		doorsOf.set(login.memberId, list);
	}

	const rows: MemberRow[] = [];
	for (const member of members) {
		const identity = await identityOf(db, secrets, member.id);
		rows.push({
			id: member.id,
			name: displayName(identity) || '(no name on file)',
			username: identity.username ?? null,
			handle: identity.handle ?? null,
			doors: (doorsOf.get(member.id) ?? []).sort().join(' + ') || 'none',
			status: member.status,
			isAdmin: member.isAdmin,
			entryCount: stats.get(member.id)?.count ?? 0,
			lastEntry: stats.get(member.id)?.last || null
		});
	}
	// Pending first, then admins, then by name.
	rows.sort((a, b) => {
		if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
		if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return rows;
}

/* ---------------------------------------------------------------- */
/* Actions - each one logs                                           */

export async function approveMember(db: Db, date: string, actorId: string, id: string) {
	await db.update(table.members).set({ status: 'approved' }).where(eq(table.members.id, id));
	await logAdmin(db, date, actorId, 'approved the account', id);
}

/** Deny deletes the registration entirely (owner ruling): the
 * username frees up as if it was never asked for. Pending only. */
export async function denyMember(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<boolean> {
	const member = (await db.select().from(table.members).where(eq(table.members.id, id)))[0];
	if (!member || member.status !== 'pending') return false;
	await db.delete(table.logins).where(eq(table.logins.memberId, id));
	await db.delete(table.directory).where(eq(table.directory.memberId, id));
	await db.delete(table.members).where(eq(table.members.id, id));
	await logAdmin(db, date, actorId, 'denied a registration', null, null);
	return true;
}

export type RoleResult = { ok: true } | { ok: false; reason: 'self' | 'last-admin' };

export async function setAdminRole(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	makeAdmin: boolean
): Promise<RoleResult> {
	if (!makeAdmin) {
		// You cannot un-admin yourself, and the site refuses to lose
		// its last admin.
		if (id === actorId) return { ok: false, reason: 'self' };
		const admins = await db.select().from(table.members).where(eq(table.members.isAdmin, true));
		if (admins.length <= 1 && admins.some((a) => a.id === id)) {
			return { ok: false, reason: 'last-admin' };
		}
	}
	// The member row is the only place authority lives (fix pass
	// 2026-08-25): every session reads it fresh, so this one write is
	// the whole change. There used to be a second write keeping a
	// session-side copy honest - a copy someone would eventually
	// forget.
	await db.update(table.members).set({ isAdmin: makeAdmin }).where(eq(table.members.id, id));
	await logAdmin(db, date, actorId, makeAdmin ? 'made an admin' : 'removed admin', id);
	return { ok: true };
}

export type PassphraseResult =
	{ ok: true } | { ok: false; reason: 'no-password-door' | 'bad-passphrase' };

/** The admin types a temporary passphrase to hand over out of band;
 * the member's next sign-in is walled off until they replace it. */
export async function setTempPassphrase(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	passphrase: string
): Promise<PassphraseResult> {
	// A temporary passphrase signs somebody in before they change it, so
	// it is a working credential and holds to the same length as any
	// other password (security pass, 2026-08-24 - it used to allow 8).
	if (passphrase.length < PASSWORD_MIN || passphrase.length > PASSWORD_MAX) {
		return { ok: false, reason: 'bad-passphrase' };
	}
	const login = (
		await db
			.select()
			.from(table.logins)
			.where(and(eq(table.logins.memberId, id), eq(table.logins.kind, 'password')))
	)[0];
	if (!login) return { ok: false, reason: 'no-password-door' };
	await db
		.update(table.logins)
		.set({ passwordHash: await hashPassword(passphrase), mustChange: true })
		.where(eq(table.logins.lookupHash, login.lookupHash));
	// A stolen-session reset should also sign the old sessions out.
	await db.delete(table.sessions).where(eq(table.sessions.memberId, id));
	await logAdmin(db, date, actorId, 'set a temporary passphrase', id);
	return { ok: true };
}

/** Departed cleanup (owner ruling: full purge). Everything the member
 * ever was leaves the database; the log line survives, unlinkable. */
export async function purgeMember(db: Db, date: string, actorId: string, id: string) {
	const entryIds = (
		await db
			.select({ id: table.entries.id })
			.from(table.entries)
			.where(eq(table.entries.memberId, id))
	).map((e) => e.id);
	if (entryIds.length) {
		await db.delete(table.entryValues).where(inArray(table.entryValues.entryId, entryIds));
	}
	await db.delete(table.entries).where(eq(table.entries.memberId, id));
	await db.delete(table.memberAudit).where(eq(table.memberAudit.memberId, id));
	await db.delete(table.sessions).where(eq(table.sessions.memberId, id));
	await db.delete(table.logins).where(eq(table.logins.memberId, id));
	await db.delete(table.directory).where(eq(table.directory.memberId, id));
	await db.delete(table.members).where(eq(table.members.id, id));
	await logAdmin(
		db,
		date,
		actorId,
		'removed a departed member',
		null,
		`${entryIds.length} entries erased`
	);
}

/* ---------------------------------------------------------------- */
/* Corrections - the member_audit trail, for admin review            */

export type CorrectionLine = {
	date: string;
	member: string;
	action: 'edit' | 'delete';
	entryDate: string;
	before: string;
};

export async function readCorrections(
	db: Db,
	secrets: Secrets,
	limit = 100
): Promise<CorrectionLine[]> {
	const rows = await db
		.select()
		.from(table.memberAudit)
		.orderBy(desc(table.memberAudit.date), desc(sql`rowid`))
		.limit(limit);
	const names = new Map<string, string>();
	const out: CorrectionLine[] = [];
	for (const row of rows) {
		if (!names.has(row.memberId)) {
			names.set(
				row.memberId,
				displayName(await identityOf(db, secrets, row.memberId)) || 'a departed member'
			);
		}
		out.push({
			date: row.date,
			member: names.get(row.memberId)!,
			action: row.action,
			entryDate: row.entryDate,
			before: row.before
		});
	}
	return out;
}
