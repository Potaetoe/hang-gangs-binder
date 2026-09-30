import type { Cookies } from '@sveltejs/kit';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db';
import * as table from '../db/schema';
import { randomToken, sha256Hex } from '../crypto';
import { nowSeconds } from '../days';

/** __Host- makes the browser itself refuse the cookie unless it is
 * Secure, on path "/", and bound to this exact host. */
export const SESSION_COOKIE = '__Host-session';

const SESSION_DAYS = 30;
/** An unused session dies after a week. */
const IDLE_DAYS = 7;
/** Past this many live sessions, the oldest go. */
const SESSION_CAP = 3;
const DAY = 86_400;

/** Midnight tonight plus some days. Rounding to the day means the row
 * never records the minute anyone signed in or came back. */
const dayBoundary = (days: number) => (Math.floor(nowSeconds() / DAY) + 1 + days) * DAY;

export function setSessionCookie(cookies: Cookies, token: string) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: SESSION_DAYS * DAY
	});
}

/** A session says who, never what they may do: authority lives on the
 * member row alone, so a role change holds from the next click. */
export async function createSession(db: Db, memberId: string): Promise<string> {
	const token = randomToken();
	await db.insert(table.sessions).values({
		tokenHash: await sha256Hex(token),
		memberId,
		expiresAt: dayBoundary(SESSION_DAYS),
		idleExpiresAt: dayBoundary(IDLE_DAYS)
	});
	// "Oldest" comes from the day-rounded expiry, with rowid breaking
	// ties, because there is deliberately no created_at to sort by.
	const rows = await db
		.select({ tokenHash: table.sessions.tokenHash })
		.from(table.sessions)
		.where(eq(table.sessions.memberId, memberId))
		.orderBy(desc(table.sessions.expiresAt), desc(sql`rowid`));
	const excess = rows.slice(SESSION_CAP).map((r) => r.tokenHash);
	if (excess.length) {
		await db.delete(table.sessions).where(inArray(table.sessions.tokenHash, excess));
	}
	return token;
}

export type SessionMember = { memberId: string; isAdmin: boolean; mustChange: boolean };

export async function sessionMember(
	db: Db,
	token: string | undefined
): Promise<SessionMember | null> {
	if (!token) return null;
	const hash = await sha256Hex(token);
	const [row] = await db.select().from(table.sessions).where(eq(table.sessions.tokenHash, hash));
	if (!row) return null;
	const now = nowSeconds();
	if (row.expiresAt < now || row.idleExpiresAt < now) {
		// Sweep every dead session, not just this one: each is a member id
		// sitting in the database for no reason.
		await db
			.delete(table.sessions)
			.where(or(lt(table.sessions.expiresAt, now), lt(table.sessions.idleExpiresAt, now)));
		return null;
	}
	const [member] = await db.select().from(table.members).where(eq(table.members.id, row.memberId));
	if (!member || member.status !== 'approved') return null;
	// Sliding the idle expiry only ever moves it to a later day, so this
	// writes at most once a day and records nothing finer.
	const slid = dayBoundary(IDLE_DAYS);
	if (row.idleExpiresAt < slid) {
		await db
			.update(table.sessions)
			.set({ idleExpiresAt: slid })
			.where(eq(table.sessions.tokenHash, hash));
	}
	const [login] = await db
		.select({ mustChange: table.logins.mustChange })
		.from(table.logins)
		.where(and(eq(table.logins.memberId, member.id), eq(table.logins.kind, 'password')));
	return { memberId: member.id, isAdmin: member.isAdmin, mustChange: login?.mustChange ?? false };
}

export async function destroySession(db: Db, token: string | undefined) {
	if (!token) return;
	await db.delete(table.sessions).where(eq(table.sessions.tokenHash, await sha256Hex(token)));
}
