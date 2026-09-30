import { and, eq, lt, ne } from 'drizzle-orm';
import type { Db } from '../db';
import * as table from '../db/schema';
import {
	DECOY_HASH,
	hashPassword,
	hmacHex,
	needsRehash,
	randomToken,
	sha1Hex,
	verifyPassword
} from '../crypto';
import { nowSeconds, utcDay } from '../days';
import { cleanDisplayName, writeIdentity } from '../identity';
import { createSession } from './sessions';

type PasswordEnv = Pick<Env, 'ID_SECRET' | 'DIRECTORY_SECRET' | 'TEST_HOOKS'>;

const USERNAME = /^[a-z0-9_]{3,32}$/;

/** The ASD STIG's floor. An admin's temporary passphrase signs someone
 * in, so it is held to the same length. */
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;

export const BREACHED_MESSAGE =
	'That password turns up in known password leaks, so it is already being guessed. Pick another one.';

const lookupFor = (env: PasswordEnv, username: string) =>
	hmacHex(env.ID_SECRET, `password:${username.trim().toLowerCase()}`);

/**
 * Length alone does not save "password123456" (NIST). Only the first
 * five characters of the SHA-1 leave the Worker, and the match happens
 * here, so the service never learns which password was asked about.
 * If it cannot be reached the password goes through: locking a member
 * out because someone else's API is down is worse.
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

/** Length first, so an obviously short password never costs a round
 * trip. The test suite skips the breach lookup to stay offline. */
async function passwordProblem(
	env: Pick<Env, 'TEST_HOOKS'>,
	password: string
): Promise<'bad-password' | 'breached-password' | null> {
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return 'bad-password';
	if (env.TEST_HOOKS === '1') return null;
	return (await isBreachedPassword(password)) ? 'breached-password' : null;
}

export type RegisterResult =
	| { ok: true }
	| { ok: false; reason: 'username-taken' | 'bad-username' | 'bad-password' | 'breached-password' };

export async function register(
	db: Db,
	env: PasswordEnv,
	usernameRaw: string,
	password: string,
	displayName: string
): Promise<RegisterResult> {
	const username = usernameRaw.trim().toLowerCase();
	if (!USERNAME.test(username)) return { ok: false, reason: 'bad-username' };
	const problem = await passwordProblem(env, password);
	if (problem) return { ok: false, reason: problem };

	const lookupHash = await lookupFor(env, username);
	const [existing] = await db
		.select()
		.from(table.logins)
		.where(eq(table.logins.lookupHash, lookupHash));
	if (existing) return { ok: false, reason: 'username-taken' };

	const memberId = randomToken(16);
	await db.insert(table.members).values({ id: memberId, status: 'pending', createdAt: utcDay() });
	await db.insert(table.logins).values({
		lookupHash,
		memberId,
		kind: 'password',
		passwordHash: await hashPassword(password),
		createdAt: utcDay()
	});
	await writeIdentity(db, env, memberId, { username, displayName: cleanDisplayName(displayName) });
	return { ok: true };
}

/**
 * The global backoff: three misses are free, then the wait starts at 10
 * seconds and doubles per miss up to 15 minutes. Backoff, never lockout:
 * the worst a griefer can do is make a member wait, and the member's
 * own success clears it. A quiet day forgets the count.
 */
const BACKOFF_FREE_FAILS = 3;
const BACKOFF_BASE_SECONDS = 10;
const BACKOFF_CAP_SECONDS = 900;
const BACKOFF_DECAY_SECONDS = 86_400;

async function recordFailure(db: Db, lookupHash: string, priorFails: number) {
	const fails = priorFails + 1;
	const over = fails - BACKOFF_FREE_FAILS;
	const wait = over > 0 ? Math.min(BACKOFF_BASE_SECONDS * 2 ** (over - 1), BACKOFF_CAP_SECONDS) : 0;
	const blockedUntil = nowSeconds() + wait;
	await db
		.insert(table.loginBackoff)
		.values({ lookupHash, fails, blockedUntil })
		.onConflictDoUpdate({ target: table.loginBackoff.lookupHash, set: { fails, blockedUntil } });
	await db
		.delete(table.loginBackoff)
		.where(lt(table.loginBackoff.blockedUntil, nowSeconds() - BACKOFF_DECAY_SECONDS));
}

export type PasswordSignIn =
	{ ok: true; token: string } | { ok: false; reason: 'wrong' | 'pending' | 'throttled' };

export async function signInPassword(
	db: Db,
	env: PasswordEnv,
	username: string,
	password: string
): Promise<PasswordSignIn> {
	const lookupHash = await lookupFor(env, username);
	// Checked before any hashing, so a blocked attempt costs no PBKDF2.
	// Rows exist for imaginary accounts too, so "blocked" says nothing
	// about who exists.
	const [backoff] = await db
		.select()
		.from(table.loginBackoff)
		.where(eq(table.loginBackoff.lookupHash, lookupHash));
	if (backoff && backoff.blockedUntil > nowSeconds()) return { ok: false, reason: 'throttled' };
	const priorFails =
		backoff && backoff.blockedUntil >= nowSeconds() - BACKOFF_DECAY_SECONDS ? backoff.fails : 0;

	const [login] = await db
		.select()
		.from(table.logins)
		.where(eq(table.logins.lookupHash, lookupHash));
	// A missing user and a wrong password give the same answer in the
	// same time: the decoy costs exactly what a real check costs.
	const ok = await verifyPassword(password, login?.passwordHash ?? DECOY_HASH);
	if (!login?.passwordHash || !ok) {
		await recordFailure(db, lookupHash, priorFails);
		return { ok: false, reason: 'wrong' };
	}
	// The only moment the plain password is known good: bring an older
	// hash up to the current cost without asking anyone to do anything.
	if (needsRehash(login.passwordHash)) {
		await db
			.update(table.logins)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(table.logins.lookupHash, lookupHash));
	}
	if (backoff) {
		await db.delete(table.loginBackoff).where(eq(table.loginBackoff.lookupHash, lookupHash));
	}
	const [member] = await db
		.select()
		.from(table.members)
		.where(eq(table.members.id, login.memberId));
	if (!member) return { ok: false, reason: 'wrong' };
	if (member.status !== 'approved') return { ok: false, reason: 'pending' };
	return { ok: true, token: await createSession(db, member.id) };
}

export type ChangePassword =
	| { ok: true }
	| { ok: false; reason: 'wrong' | 'bad-password' | 'breached-password' | 'no-password-door' };

/** The current password (or the admin's temporary one) must verify.
 * Every other session dies, so a changed password locks a thief out. */
export async function changePassword(
	db: Db,
	env: Pick<Env, 'TEST_HOOKS'>,
	memberId: string,
	current: string,
	next: string,
	keepTokenHash: string
): Promise<ChangePassword> {
	const problem = await passwordProblem(env, next);
	if (problem) return { ok: false, reason: problem };
	const [login] = await db
		.select()
		.from(table.logins)
		.where(and(eq(table.logins.memberId, memberId), eq(table.logins.kind, 'password')));
	if (!login?.passwordHash) return { ok: false, reason: 'no-password-door' };
	if (!(await verifyPassword(current, login.passwordHash))) return { ok: false, reason: 'wrong' };
	await db
		.update(table.logins)
		.set({ passwordHash: await hashPassword(next), mustChange: false })
		.where(eq(table.logins.lookupHash, login.lookupHash));
	await db
		.delete(table.sessions)
		.where(and(eq(table.sessions.memberId, memberId), ne(table.sessions.tokenHash, keepTokenHash)));
	return { ok: true };
}
