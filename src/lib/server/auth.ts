/**
 * The two doors (DESIGN.md, "Sign-in: two doors") and the sessions
 * behind both. Every function takes the db and the env it needs -
 * nothing reads globals, so tests drive it the same way routes do.
 */

import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import {
	hashPassword,
	hmacHex,
	open,
	randomToken,
	seal,
	sha256Hex,
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
};

const now = () => Math.floor(Date.now() / 1000);
const SESSION_DAYS = 30;

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
		.values({ memberId, sealed, updatedAt: now() })
		.onConflictDoUpdate({
			target: table.directory.memberId,
			set: { sealed, updatedAt: now() }
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

export async function createSession(db: Db, memberId: string, isAdmin: boolean) {
	const token = randomToken();
	await db.insert(table.sessions).values({
		tokenHash: await sha256Hex(token),
		memberId,
		isAdmin,
		createdAt: now(),
		expiresAt: now() + SESSION_DAYS * 86_400
	});
	return token;
}

export async function sessionMember(db: Db, token: string | undefined) {
	if (!token) return null;
	const hash = await sha256Hex(token);
	const row = (await db.select().from(table.sessions).where(eq(table.sessions.tokenHash, hash)))[0];
	if (!row || row.expiresAt < now()) return null;
	const member = (
		await db.select().from(table.members).where(eq(table.members.id, row.memberId))
	)[0];
	if (!member || member.status !== 'approved') return null;
	return { memberId: member.id, isAdmin: row.isAdmin || member.isAdmin };
}

export async function destroySession(db: Db, token: string | undefined) {
	if (!token) return;
	await db.delete(table.sessions).where(eq(table.sessions.tokenHash, await sha256Hex(token)));
}

/* ---------------------------------------------------------------- */
/* The password door                                                 */

export type RegisterResult =
	{ ok: true } | { ok: false; reason: 'username-taken' | 'bad-username' | 'bad-password' };

const USERNAME = /^[a-z0-9_]{3,32}$/;

export async function register(
	db: Db,
	secrets: Secrets,
	usernameRaw: string,
	password: string,
	displayName: string
): Promise<RegisterResult> {
	const username = usernameRaw.trim().toLowerCase();
	if (!USERNAME.test(username)) return { ok: false, reason: 'bad-username' };
	if (password.length < 8 || password.length > 128) return { ok: false, reason: 'bad-password' };

	const lookupHash = await hmacHex(secrets.ID_SECRET, `password:${username}`);
	const existing = (
		await db.select().from(table.logins).where(eq(table.logins.lookupHash, lookupHash))
	)[0];
	if (existing) return { ok: false, reason: 'username-taken' };

	const memberId = randomToken(16);
	await db.insert(table.members).values({ id: memberId, status: 'pending', createdAt: now() });
	await db.insert(table.logins).values({
		lookupHash,
		memberId,
		kind: 'password',
		passwordHash: await hashPassword(password),
		createdAt: now()
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
	// purpose: the door does not confirm which usernames exist.
	if (!login?.passwordHash) return { ok: false, reason: 'wrong' };
	if (!(await verifyPassword(password, login.passwordHash))) {
		return { ok: false, reason: 'wrong' };
	}
	const member = (
		await db.select().from(table.members).where(eq(table.members.id, login.memberId))
	)[0];
	if (!member) return { ok: false, reason: 'wrong' };
	if (member.status !== 'approved') return { ok: false, reason: 'pending' };
	return { ok: true, token: await createSession(db, member.id, member.isAdmin) };
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
	if (!Number.isFinite(authDate) || Math.abs(now() - authDate) > 600) return false;
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
	return signedHex === hash.toLowerCase();
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
			createdAt: now()
		});
		await db.insert(table.logins).values({
			lookupHash,
			memberId,
			kind: 'telegram',
			passwordHash: null,
			createdAt: now()
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
	return { ok: true, token: await createSession(db, memberId, standing === 'admin') };
}
