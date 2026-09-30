import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db';
import * as table from '../db/schema';
import { hex, hmacHex, randomToken, sha256Hex, timingSafeEqual } from '../crypto';
import { nowSeconds, utcDay } from '../days';
import { identityOf, writeIdentity } from '../identity';
import { createSession } from './sessions';

type TelegramEnv = Pick<
	Env,
	| 'ID_SECRET'
	| 'DIRECTORY_SECRET'
	| 'TELEGRAM_BOT_TOKEN'
	| 'TELEGRAM_CHAT_ID'
	| 'TELEGRAM_ALLOW_IDS'
>;

/**
 * Login CSRF defence. The door page puts a random value in this cookie
 * and in the widget's return URL; a crafted /auth/telegram link cannot
 * know the cookie, so it cannot sign a victim into someone else's
 * account.
 */
export const TG_STATE_COOKIE = '__Host-tg-state';

/** A signed payload is good for two minutes, and only once. */
const TELEGRAM_WINDOW = 120;

export type TelegramPayload = Record<string, string>;

/** Telegram's login-widget signature check. */
export async function verifyTelegramPayload(
	payload: TelegramPayload,
	botToken: string
): Promise<boolean> {
	const { hash, ...fields } = payload;
	if (!hash) return false;
	const authDate = Number(fields.auth_date);
	if (!Number.isFinite(authDate) || Math.abs(nowSeconds() - authDate) > TELEGRAM_WINDOW) {
		return false;
	}
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
	const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheck));
	return timingSafeEqual(hex(signed), hash.toLowerCase());
}

/** The payload travels in a URL. Burning it on first use means a
 * captured link is already dead. */
async function burnPayload(db: Db, hash: string): Promise<boolean> {
	await db
		.delete(table.usedLogins)
		.where(lt(table.usedLogins.expiresAt, nowSeconds() - TELEGRAM_WINDOW));
	try {
		await db
			.insert(table.usedLogins)
			.values({ hash: await sha256Hex(hash), expiresAt: nowSeconds() + TELEGRAM_WINDOW });
		return true;
	} catch {
		// Primary key collision: this payload was already spent.
		return false;
	}
}

/**
 * 'operator' is the allow-list secret, which only the Cloudflare account
 * holder can set: the documented way back in when every admin is gone.
 * 'admin' is only what the Telegram group says. They must not carry the
 * same weight.
 */
type Standing = 'operator' | 'admin' | 'member' | 'out' | 'unknown';

async function groupStanding(env: TelegramEnv, telegramId: string): Promise<Standing> {
	const allowed = (env.TELEGRAM_ALLOW_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (allowed.includes(telegramId)) return 'operator';
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 'unknown';
	try {
		const res = await fetch(
			`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember` +
				`?chat_id=${encodeURIComponent(env.TELEGRAM_CHAT_ID)}` +
				`&user_id=${encodeURIComponent(telegramId)}`
		);
		const body = (await res.json()) as { ok: boolean; result?: { status?: string } };
		if (!body.ok) return 'unknown';
		const status = body.result?.status ?? '';
		if (status === 'creator' || status === 'administrator') return 'admin';
		if (status === 'member') return 'member';
		return 'out';
	} catch {
		// Unreachable Telegram proves nothing about membership.
		return 'unknown';
	}
}

export type TelegramSignIn =
	| { ok: true; token: string }
	| { ok: false; reason: 'bad-signature' | 'not-a-member' | 'unavailable' };

export async function signInTelegram(
	db: Db,
	env: TelegramEnv,
	payload: TelegramPayload
): Promise<TelegramSignIn> {
	if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'unavailable' };
	if (!(await verifyTelegramPayload(payload, env.TELEGRAM_BOT_TOKEN))) {
		return { ok: false, reason: 'bad-signature' };
	}
	if (!(await burnPayload(db, payload.hash))) return { ok: false, reason: 'bad-signature' };
	const telegramId = payload.id;
	const standing = await groupStanding(env, telegramId);
	if (standing === 'unknown') return { ok: false, reason: 'unavailable' };
	if (standing === 'out') return { ok: false, reason: 'not-a-member' };

	const lookupHash = await hmacHex(env.ID_SECRET, `telegram:${telegramId}`);
	const [login] = await db
		.select()
		.from(table.logins)
		.where(eq(table.logins.lookupHash, lookupHash));

	let memberId = login?.memberId;
	if (!memberId) {
		memberId = randomToken(16);
		await db.insert(table.members).values({
			id: memberId,
			status: 'approved',
			// A new fork's first admins arrive already trusted by the group.
			isAdmin: standing === 'operator' || standing === 'admin',
			createdAt: utcDay()
		});
		await db.insert(table.logins).values({
			lookupHash,
			memberId,
			kind: 'telegram',
			passwordHash: null,
			createdAt: utcDay()
		});
	} else if (standing === 'operator') {
		// Only the operator's list re-grants admin on a later sign-in.
		// Re-granting group admins too would quietly undo every "Remove
		// admin" the binder's own admins make.
		await db.update(table.members).set({ isAdmin: true }).where(eq(table.members.id, memberId));
	}
	// Merged over what is there, so a linked password username survives.
	const existing = await identityOf(db, env, memberId);
	await writeIdentity(db, env, memberId, {
		...existing,
		telegramId,
		handle: payload.username || existing.handle,
		displayName:
			[payload.first_name, payload.last_name].filter(Boolean).join(' ') || existing.displayName
	});
	return { ok: true, token: await createSession(db, memberId) };
}
