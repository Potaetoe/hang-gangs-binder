/**
 * The sealed directory: the one place a member id meets a name. It is
 * opened to greet someone or to show an admin who is who, and never
 * queried by content.
 */

import { eq } from 'drizzle-orm';
import type { Db } from './db';
import * as table from './db/schema';
import { open, seal } from './crypto';
import { utcDay } from './days';

export type Identity = {
	username?: string;
	displayName?: string;
	telegramId?: string;
	handle?: string;
};

type DirectoryEnv = Pick<Env, 'DIRECTORY_SECRET'>;

/**
 * A directory row exists but will not open: the secret is wrong or the
 * row was tampered with. Every write merges over what it read, so
 * treating this as empty would let one name change wipe a member's
 * identity for good. Erroring is the honest outcome.
 */
export class IdentityUnreadableError extends Error {
	constructor() {
		super('A sealed identity record exists but cannot be opened.');
		this.name = 'IdentityUnreadableError';
	}
}

async function unseal(env: DirectoryEnv, sealed: string): Promise<Identity> {
	try {
		return JSON.parse(await open(env.DIRECTORY_SECRET, sealed)) as Identity;
	} catch {
		throw new IdentityUnreadableError();
	}
}

/** What to call someone: the name they chose, else their handle or username. */
export const nameOf = (identity: Identity | undefined): string =>
	identity?.displayName || identity?.handle || identity?.username || '';

export async function identityOf(db: Db, env: DirectoryEnv, memberId: string): Promise<Identity> {
	const [row] = await db
		.select()
		.from(table.directory)
		.where(eq(table.directory.memberId, memberId));
	return row ? unseal(env, row.sealed) : {};
}

/** The whole directory in one query. It holds one row per member, so
 * this is bounded by the group's size, and a roster page costs one
 * round trip instead of one per member. */
export async function allIdentities(db: Db, env: DirectoryEnv): Promise<Map<string, Identity>> {
	const rows = await db.select().from(table.directory);
	const out = new Map<string, Identity>();
	for (const row of rows) out.set(row.memberId, await unseal(env, row.sealed));
	return out;
}

export async function writeIdentity(
	db: Db,
	env: DirectoryEnv,
	memberId: string,
	identity: Identity
) {
	const sealed = await seal(env.DIRECTORY_SECRET, JSON.stringify(identity));
	const updatedAt = utcDay();
	await db
		.insert(table.directory)
		.values({ memberId, sealed, updatedAt })
		.onConflictDoUpdate({ target: table.directory.memberId, set: { sealed, updatedAt } });
}

export const cleanDisplayName = (raw: string): string | undefined =>
	raw.trim().slice(0, 64) || undefined;

/** The member's own "call me" control; the rest of the identity stays. */
export async function setDisplayName(db: Db, env: DirectoryEnv, memberId: string, name: string) {
	const existing = await identityOf(db, env, memberId);
	await writeIdentity(db, env, memberId, { ...existing, displayName: cleanDisplayName(name) });
}
