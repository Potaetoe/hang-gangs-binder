/**
 * The two doors (DESIGN.md, "Sign-in: two doors") and the sessions
 * behind both. Every function takes the db and the env it needs -
 * nothing reads globals, so tests drive it the same way routes do.
 */

import { and, eq, lt, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import {
	DECOY_HASH,
	hashPassword,
	hmacHex,
	needsRehash,
	open,
	randomToken,
	seal,
	sha1Hex,
	sha256Hex,
	timingSafeEqual,
	verifyPassword
} from './crypto';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export type Secrets = {
	ID_SECRET: string;
	DIRECTORY_SECRET: string;
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_CHAT_ID?: string;
	/** Comma-separated numeric ids admitted without asking the bot -
	 * the operator's escape hatch, and how tests avoid calling
	 * Telegram. */
	TELEGRAM_ALLOW_IDS?: string;
	/** '1' only in local development and CI. It kills the test-only
	 * endpoints in production, and it is also what stops the test suite
	 * calling the breached-password service on every registration. */
	TEST_HOOKS?: string;
};

const isTestEnv = (secrets: Secrets) => secrets.TEST_HOOKS === '1';

const now = () => Math.floor(Date.now() / 1000);
const SESSION_DAYS = 30;
const DAY = 86_400;

/**
 * The calendar day, and nothing finer. Everything this file writes to
 * a member-linked row uses this instead of a clock (security pass,
 * 2026-08-24): a row that says WHEN to the second, sitting beside a
 * member id, is an activity log - and lining an activity log up
 * against the group's chat is exactly what DESIGN.md's date-only rule
 * exists to prevent. UTC on purpose; this is plumbing, never shown.
 */
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Midnight tonight, plus the session's life. Sessions need a real
 * expiry to enforce, but rounding to the day keeps the row from
 * recording the minute somebody signed in. */
const sessionExpiry = () => (Math.floor(now() / DAY) + 1 + SESSION_DAYS) * DAY;

/* ---------------------------------------------------------------- */
/* Identity records                                                  */

export type Identity = {
	username?: string;
	displayName?: string;
	telegramId?: string;
	handle?: string;
};

export async function identityOf(db: Db, secrets: Secrets, memberId: string): Promise<Identity> {
	const row = (
		await db.select().from(table.directory).where(eq(table.directory.memberId, memberId))
	)[0];
	if (!row) return {};
	try {
		return JSON.parse(await open(secrets.DIRECTORY_SECRET, row.sealed)) as Identity;
	} catch {
		return {};
	}
}

async function writeIdentity(db: Db, secrets: Secrets, memberId: string, identity: Identity) {
	const sealed = await seal(secrets.DIRECTORY_SECRET, JSON.stringify(identity));
	await db
		.insert(table.directory)
		.values({ memberId, sealed, updatedAt: todayUtc() })
		.onConflictDoUpdate({
			target: table.directory.memberId,
			set: { sealed, updatedAt: todayUtc() }
		});
}

/** Your page's "call me" control (owner ruling 2026-08-24): the
 * display name is the member's to change; the rest of the sealed
 * identity stays as it is. */
export async function setDisplayName(db: Db, secrets: Secrets, memberId: string, name: string) {
	const existing = await identityOf(db, secrets, memberId);
	await writeIdentity(db, secrets, memberId, {
		...existing,
		displayName: name.trim().slice(0, 64) || undefined
	});
}

/* ---------------------------------------------------------------- */
/* Sessions                                                          */

/** A session says WHO, never what they may do (fix pass 2026-08-25).
 * It used to carry an is_admin snapshot too, which meant two places
 * could disagree about the same power - the member row is the only
 * place authority lives now. */
export async function createSession(db: Db, memberId: string) {
	const token = randomToken();
	await db.insert(table.sessions).values({
		tokenHash: await sha256Hex(token),
		memberId,
		expiresAt: sessionExpiry()
	});
	return token;
}

export async function sessionMember(db: Db, token: string | undefined) {
	if (!token) return null;
	const hash = await sha256Hex(token);
	const row = (await db.select().from(table.sessions).where(eq(table.sessions.tokenHash, hash)))[0];
	if (!row) return null;
	if (row.expiresAt < now()) {
		// Sweep it rather than just refusing it: a dead session row is
		// still a member id sitting in the database for no reason.
		await db.delete(table.sessions).where(lt(table.sessions.expiresAt, now()));
		return null;
	}
	const member = (
		await db.select().from(table.members).where(eq(table.members.id, row.memberId))
	)[0];
	if (!member || member.status !== 'approved') return null;
	// A temporary passphrase walls the whole site off behind the
	// password-change page (owner ruling 2026-08-24).
	const login = (
		await db
			.select({ mustChange: table.logins.mustChange })
			.from(table.logins)
			.where(and(eq(table.logins.memberId, member.id), eq(table.logins.kind, 'password')))
	)[0];
	return {
		memberId: member.id,
		// Read fresh from the member row on every request, so a role
		// change - either direction - holds from the next click, for
		// every session the member has (fix pass 2026-08-25).
		isAdmin: member.isAdmin,
		mustChange: login?.mustChange ?? false
	};
}

export async function destroySession(db: Db, token: string | undefined) {
	if (!token) return;
	await db.delete(table.sessions).where(eq(table.sessions.tokenHash, await sha256Hex(token)));
}

/* ---------------------------------------------------------------- */
/* The password door                                                 */

export type RegisterResult =
	| { ok: true }
	| { ok: false; reason: 'username-taken' | 'bad-username' | 'bad-password' | 'breached-password' };

const USERNAME = /^[a-z0-9_]{3,32}$/;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * Is this password one of the ones already in circulation from other
 * sites' breaches? (Owner ruling 2026-08-24, following NIST: length
 * alone does not save "password123456".)
 *
 * Only the first five characters of the password's SHA-1 ever leave
 * this Worker, and the answer comes back as a list of thousands of
 * suffixes we match locally - so the service is never told which
 * password was asked about, or by whom.
 *
 * If the service is unreachable we let the password through. A member
 * locked out of setting a password because someone else's API is down
 * is a worse outcome than a weak password on a private site.
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
	const digest = (await sha1Hex(password)).toUpperCase();
	const prefix = digest.slice(0, 5);
	const suffix = digest.slice(5);
	try {
		const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
			headers: { 'Add-Padding': 'true' }
		});
		if (!res.ok) return false;
		const body = await res.text();
		return body.split('\n').some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix);
	} catch {
		return false;
	}
}

/** Length first, then the breach list - so an obviously-too-short
 * password never costs a network round trip. */
async function passwordProblem(
	password: string,
	skipBreachCheck = false
): Promise<'bad-password' | 'breached-password' | null> {
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return 'bad-password';
	if (skipBreachCheck) return null;
	return (await isBreachedPassword(password)) ? 'breached-password' : null;
}

export async function register(
	db: Db,
	secrets: Secrets,
	usernameRaw: string,
	password: string,
	displayName: string
): Promise<RegisterResult> {
	const username = usernameRaw.trim().toLowerCase();
	if (!USERNAME.test(username)) return { ok: false, reason: 'bad-username' };
	const problem = await passwordProblem(password, isTestEnv(secrets));
	if (problem) return { ok: false, reason: problem };

	const lookupHash = await hmacHex(secrets.ID_SECRET, `password:${username}`);
	const existing = (
		await db.select().from(table.logins).where(eq(table.logins.lookupHash, lookupHash))
	)[0];
	if (existing) return { ok: false, reason: 'username-taken' };

	const memberId = randomToken(16);
	await db.insert(table.members).values({ id: memberId, status: 'pending', createdAt: todayUtc() });
	await db.insert(table.logins).values({
		lookupHash,
		memberId,
		kind: 'password',
		passwordHash: await hashPassword(password),
		createdAt: todayUtc()
	});
	await writeIdentity(db, secrets, memberId, {
		username,
		displayName: displayName.trim().slice(0, 64) || undefined
	});
	return { ok: true };
}

export type PasswordSignIn =
	{ ok: true; token: string } | { ok: false; reason: 'wrong' | 'pending' };

export async function signInPassword(
	db: Db,
	secrets: Secrets,
	usernameRaw: string,
	password: string
): Promise<PasswordSignIn> {
	const username = usernameRaw.trim().toLowerCase();
	const lookupHash = await hmacHex(secrets.ID_SECRET, `password:${username}`);
	const login = (
		await db.select().from(table.logins).where(eq(table.logins.lookupHash, lookupHash))
	)[0];
	// A missing user and a wrong password are the same answer on
	// purpose: the door does not confirm which usernames exist. It used
	// to give that answer FASTER when nobody matched, because only the
	// real branch paid for PBKDF2 - a ~35ms tell, measured during the
	// security pass. Verifying against a decoy costs the same, so the
	// two paths now take the same time as well as saying the same thing.
	if (!login?.passwordHash) {
		await verifyPassword(password, DECOY_HASH);
		return { ok: false, reason: 'wrong' };
	}
	if (!(await verifyPassword(password, login.passwordHash))) {
		return { ok: false, reason: 'wrong' };
	}
	// The one moment the plain password is in hand and known good: if it
	// is stored under an older, cheaper scheme, write it back at the
	// current one. Nobody is asked to do anything, and the store
	// converges on a single cost.
	if (needsRehash(login.passwordHash)) {
		await db
			.update(table.logins)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(table.logins.lookupHash, login.lookupHash));
	}
	const member = (
		await db.select().from(table.members).where(eq(table.members.id, login.memberId))
	)[0];
	if (!member) return { ok: false, reason: 'wrong' };
	if (member.status !== 'approved') return { ok: false, reason: 'pending' };
	return { ok: true, token: await createSession(db, member.id) };
}

export type ChangePassword =
	| { ok: true }
	| { ok: false; reason: 'wrong' | 'bad-password' | 'breached-password' | 'no-password-door' };

/** The member picks a new password: the current one (or the admin's
 * temporary passphrase) must verify, the walled-off flag clears, and
 * every OTHER session dies - a changed password should lock a stolen
 * one out. */
export async function changePassword(
	db: Db,
	memberId: string,
	current: string,
	next: string,
	keepTokenHash: string,
	skipBreachCheck = false
): Promise<ChangePassword> {
	const problem = await passwordProblem(next, skipBreachCheck);
	if (problem) return { ok: false, reason: problem };
	const login = (
		await db
			.select()
			.from(table.logins)
			.where(and(eq(table.logins.memberId, memberId), eq(table.logins.kind, 'password')))
	)[0];
	if (!login?.passwordHash) return { ok: false, reason: 'no-password-door' };
	if (!(await verifyPassword(current, login.passwordHash))) {
		return { ok: false, reason: 'wrong' };
	}
	await db
		.update(table.logins)
		.set({ passwordHash: await hashPassword(next), mustChange: false })
		.where(eq(table.logins.lookupHash, login.lookupHash));
	await db
		.delete(table.sessions)
		.where(and(eq(table.sessions.memberId, memberId), ne(table.sessions.tokenHash, keepTokenHash)));
	return { ok: true };
}

/* ---------------------------------------------------------------- */
/* The Telegram door                                                 */

export type TelegramPayload = Record<string, string>;

/** Telegram's login-widget signature check, written out so a test can
 * sign a fixture with a known token and prove both directions. */
export async function verifyTelegramPayload(
	payload: TelegramPayload,
	botToken: string
): Promise<boolean> {
	const { hash, ...fields } = payload;
	if (!hash) return false;
	const authDate = Number(fields.auth_date);
	if (!Number.isFinite(authDate) || Math.abs(now() - authDate) > TELEGRAM_WINDOW) return false;
	const dataCheck = Object.keys(fields)
		.sort()
		.map((k) => `${k}=${fields[k]}`)
		.join('\n');
	const secretKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
	const key = await crypto.subtle.importKey(
		'raw',
		secretKey,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signed = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheck))
	);
	const signedHex = [...signed].map((b) => b.toString(16).padStart(2, '0')).join('');
	// Constant-time, like the password path - the two comparisons in
	// this file should not disagree about how carefully they compare.
	return timingSafeEqual(signedHex, hash.toLowerCase());
}

/**
 * A signed Telegram payload is good once, and only for a couple of
 * minutes (security pass, 2026-08-24). It used to be good for ten
 * minutes and any number of times, and it travels in a URL - so a
 * captured link was a working key for the window's remainder. Burning
 * the hash on first use turns a captured link into a dead one.
 */
const TELEGRAM_WINDOW = 120;

async function burnPayload(db: Db, hash: string): Promise<boolean> {
	const cutoff = now() - TELEGRAM_WINDOW;
	await db.delete(table.usedLogins).where(lt(table.usedLogins.expiresAt, cutoff));
	try {
		await db
			.insert(table.usedLogins)
			.values({ hash: await sha256Hex(hash), expiresAt: now() + TELEGRAM_WINDOW });
		return true;
	} catch {
		// The primary key already holds it: this payload has been spent.
		return false;
	}
}

type Standing = 'member' | 'admin' | 'out' | 'unknown';

async function groupStanding(secrets: Secrets, telegramId: string): Promise<Standing> {
	const allowed = (secrets.TELEGRAM_ALLOW_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (allowed.includes(telegramId)) return 'admin';
	if (!secrets.TELEGRAM_BOT_TOKEN || !secrets.TELEGRAM_CHAT_ID) return 'unknown';
	try {
		const res = await fetch(
			`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/getChatMember` +
				`?chat_id=${encodeURIComponent(secrets.TELEGRAM_CHAT_ID)}` +
				`&user_id=${encodeURIComponent(telegramId)}`
		);
		const body = (await res.json()) as {
			ok: boolean;
			result?: { status?: string };
		};
		if (!body.ok) return 'unknown';
		const status = body.result?.status ?? '';
		if (status === 'creator' || status === 'administrator') return 'admin';
		if (status === 'member') return 'member';
		return 'out';
	} catch {
		// An unreachable Telegram proves nothing about membership -
		// refuse without claiming anyone left.
		return 'unknown';
	}
}

export type TelegramSignIn =
	| { ok: true; token: string }
	| { ok: false; reason: 'bad-signature' | 'not-a-member' | 'unavailable' };

export async function signInTelegram(
	db: Db,
	secrets: Secrets,
	payload: TelegramPayload
): Promise<TelegramSignIn> {
	if (!secrets.TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'unavailable' };
	if (!(await verifyTelegramPayload(payload, secrets.TELEGRAM_BOT_TOKEN))) {
		return { ok: false, reason: 'bad-signature' };
	}
	// Signed, fresh - and not already spent.
	if (!(await burnPayload(db, payload.hash))) return { ok: false, reason: 'bad-signature' };
	const telegramId = payload.id;
	const standing = await groupStanding(secrets, telegramId);
	if (standing === 'unknown') return { ok: false, reason: 'unavailable' };
	if (standing === 'out') return { ok: false, reason: 'not-a-member' };

	const lookupHash = await hmacHex(secrets.ID_SECRET, `telegram:${telegramId}`);
	const login = (
		await db.select().from(table.logins).where(eq(table.logins.lookupHash, lookupHash))
	)[0];

	let memberId = login?.memberId;
	if (!memberId) {
		memberId = randomToken(16);
		await db.insert(table.members).values({
			id: memberId,
			status: 'approved',
			isAdmin: standing === 'admin',
			createdAt: todayUtc()
		});
		await db.insert(table.logins).values({
			lookupHash,
			memberId,
			kind: 'telegram',
			passwordHash: null,
			createdAt: todayUtc()
		});
	} else if (standing === 'admin') {
		await db.update(table.members).set({ isAdmin: true }).where(eq(table.members.id, memberId));
	}
	// Merged over what is already there, so a linked password
	// identity's username survives a Telegram sign-in.
	const existing = await identityOf(db, secrets, memberId);
	await writeIdentity(db, secrets, memberId, {
		...existing,
		telegramId,
		handle: payload.username || existing.handle,
		displayName:
			[payload.first_name, payload.last_name].filter(Boolean).join(' ') || existing.displayName
	});
	return { ok: true, token: await createSession(db, memberId) };
}
