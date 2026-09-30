import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { logins } from './db/schema';
import { hmacHex } from './crypto';

/**
 * The runtime half of the /test/* boundary. The build-time half is
 * `__TEST_HOOKS__` (vite.config.ts): a plain production build folds it to
 * false and every hook handler, this module included, is dropped. This
 * guard only exists in builds that compiled the hooks in, and there it
 * still demands the runtime flag.
 *
 * The 404 text is the deploy gate's marker: it can only appear in a
 * bundle that compiled the hooks in, so hooks/deploy_gate.py refuses to
 * ship any bundle that contains it.
 */
export function requireTestHooks(env: Pick<Env, 'TEST_HOOKS'>): void {
	if (env.TEST_HOOKS !== '1') error(404, 'BINDER-TEST-HOOKS-COMPILED-IN');
}

/** The member behind a password username, so the suite can reach
 * accounts it registered through the real form. */
export async function memberIdByUsername(
	db: Db,
	env: Pick<Env, 'ID_SECRET'>,
	username: string
): Promise<string> {
	const lookupHash = await hmacHex(env.ID_SECRET, `password:${username.toLowerCase()}`);
	const [login] = await db.select().from(logins).where(eq(logins.lookupHash, lookupHash));
	if (!login) error(404, 'No such registration');
	return login.memberId;
}
