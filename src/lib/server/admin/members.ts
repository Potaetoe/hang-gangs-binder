import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db';
import * as table from '../db/schema';
import { runBatch } from '../db';
import { hashPassword } from '../crypto';
import { allIdentities, nameOf } from '../identity';
import { PASSWORD_MAX, PASSWORD_MIN } from '../auth';
import { logAdminQuery } from '../changelog';

export type MemberRow = {
	id: string;
	name: string;
	username: string | null;
	status: 'pending' | 'approved';
	isAdmin: boolean;
	doors: string;
	entryCount: number;
	lastEntry: string | null;
};

/** Pending first, then admins, then by name. */
export async function memberRoster(
	db: Db,
	env: Pick<Env, 'DIRECTORY_SECRET'>
): Promise<MemberRow[]> {
	const members = await db.select().from(table.members);
	const logins = await db
		.select({ memberId: table.logins.memberId, kind: table.logins.kind })
		.from(table.logins);
	const stats = await db
		.select({
			memberId: table.entries.memberId,
			count: sql<number>`count(*)`,
			last: sql<string>`max(${table.entries.date})`
		})
		.from(table.entries)
		.groupBy(table.entries.memberId);
	const statsOf = new Map(stats.map((s) => [s.memberId, s]));
	const identities = await allIdentities(db, env);

	const rows = members.map((member) => {
		const identity = identities.get(member.id);
		const doors = logins.filter((l) => l.memberId === member.id).map((l) => l.kind);
		return {
			id: member.id,
			name: nameOf(identity) || '(no name on file)',
			username: identity?.username ?? null,
			status: member.status,
			isAdmin: member.isAdmin,
			doors: doors.sort().join(' + ') || 'none',
			entryCount: statsOf.get(member.id)?.count ?? 0,
			lastEntry: statsOf.get(member.id)?.last ?? null
		};
	});
	return rows.sort((a, b) => {
		if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
		if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

export async function pendingCount(db: Db): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(table.members)
		.where(eq(table.members.status, 'pending'));
	return row?.n ?? 0;
}

/** Backoff rows are keyed by the login's lookup hash, so they must go
 * while the logins still exist to name them. */
const backoffQuery = (db: Db, memberId: string) =>
	db
		.delete(table.loginBackoff)
		.where(
			inArray(
				table.loginBackoff.lookupHash,
				db
					.select({ h: table.logins.lookupHash })
					.from(table.logins)
					.where(eq(table.logins.memberId, memberId))
			)
		);

export async function approveMember(db: Db, date: string, actorId: string, id: string) {
	await runBatch(db, [
		db.update(table.members).set({ status: 'approved' }).where(eq(table.members.id, id)),
		logAdminQuery(db, date, actorId, 'approved the account', id)
	]);
}

/** Deny deletes the registration outright, so the username frees up as
 * if it was never asked for. Pending accounts only. */
export async function denyMember(
	db: Db,
	date: string,
	actorId: string,
	id: string
): Promise<boolean> {
	const [member] = await db.select().from(table.members).where(eq(table.members.id, id));
	if (member?.status !== 'pending') return false;
	await runBatch(db, [
		backoffQuery(db, id),
		db.delete(table.logins).where(eq(table.logins.memberId, id)),
		db.delete(table.directory).where(eq(table.directory.memberId, id)),
		db.delete(table.members).where(eq(table.members.id, id)),
		logAdminQuery(db, date, actorId, 'denied a registration')
	]);
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
		if (id === actorId) return { ok: false, reason: 'self' };
		const admins = await db.select().from(table.members).where(eq(table.members.isAdmin, true));
		if (admins.length <= 1 && admins.some((a) => a.id === id)) {
			return { ok: false, reason: 'last-admin' };
		}
	}
	// Sessions read authority from the member row on every request, so
	// this one write is the whole change.
	await runBatch(db, [
		db.update(table.members).set({ isAdmin: makeAdmin }).where(eq(table.members.id, id)),
		logAdminQuery(db, date, actorId, makeAdmin ? 'made an admin' : 'removed admin', id)
	]);
	return { ok: true };
}

export type PassphraseResult =
	{ ok: true } | { ok: false; reason: 'no-password-door' | 'bad-passphrase' };

/** The admin hands the passphrase over out of band. The member's next
 * sign-in is walled off until they pick their own, and every open
 * session ends now in case this reset is about a stolen one. */
export async function setTempPassphrase(
	db: Db,
	date: string,
	actorId: string,
	id: string,
	passphrase: string
): Promise<PassphraseResult> {
	if (passphrase.length < PASSWORD_MIN || passphrase.length > PASSWORD_MAX) {
		return { ok: false, reason: 'bad-passphrase' };
	}
	const [login] = await db
		.select()
		.from(table.logins)
		.where(and(eq(table.logins.memberId, id), eq(table.logins.kind, 'password')));
	if (!login) return { ok: false, reason: 'no-password-door' };
	await runBatch(db, [
		db
			.update(table.logins)
			.set({ passwordHash: await hashPassword(passphrase), mustChange: true })
			.where(eq(table.logins.lookupHash, login.lookupHash)),
		db.delete(table.sessions).where(eq(table.sessions.memberId, id)),
		logAdminQuery(db, date, actorId, 'set a temporary passphrase', id)
	]);
	return { ok: true };
}

/**
 * Departed cleanup: everything the member ever was leaves in one batch,
 * and the log keeps one line that no longer points at anyone. Values go
 * by subquery, because a bound list of a long history's entry ids would
 * blow D1's per-query parameter cap.
 */
export async function purgeMember(db: Db, date: string, actorId: string, id: string) {
	const [{ entryCount }] = await db
		.select({ entryCount: sql<number>`count(*)` })
		.from(table.entries)
		.where(eq(table.entries.memberId, id));
	await runBatch(db, [
		db
			.delete(table.entryValues)
			.where(
				inArray(
					table.entryValues.entryId,
					db
						.select({ id: table.entries.id })
						.from(table.entries)
						.where(eq(table.entries.memberId, id))
				)
			),
		db.delete(table.entries).where(eq(table.entries.memberId, id)),
		db.delete(table.memberAudit).where(eq(table.memberAudit.memberId, id)),
		db.delete(table.sessions).where(eq(table.sessions.memberId, id)),
		backoffQuery(db, id),
		db.delete(table.logins).where(eq(table.logins.memberId, id)),
		db.delete(table.socials).where(eq(table.socials.memberId, id)),
		db.delete(table.eventRsvps).where(eq(table.eventRsvps.memberId, id)),
		db.delete(table.directory).where(eq(table.directory.memberId, id)),
		db.delete(table.members).where(eq(table.members.id, id)),
		logAdminQuery(
			db,
			date,
			actorId,
			'removed a departed member',
			null,
			`${entryCount} entries erased`
		)
	]);
}
