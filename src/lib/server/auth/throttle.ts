/**
 * The per-edge brake on the forms that take a password or reveal
 * whether a username exists. Cloudflare's dashboard rate limits need a
 * domain we own and workers.dev is not one, so the limit lives here.
 *
 * The count is per edge location, not global: someone spread across
 * edges gets a multiple. It still turns scripted guessing into a crawl,
 * and the global per-account backoff (password.ts) sits behind it.
 */

/** Cloudflare sets this header at the edge; a client cannot forge it. */
const clientKey = (request: Request, suffix: string) =>
	`${suffix}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`;

/**
 * Fails open with no binding (local dev), in the test suite, or if the
 * limiter itself errors. Locking the group out of its own binder over
 * an internal fault is worse than letting one guess through.
 */
export async function tooManyAttempts(
	env: Pick<Env, 'LOGIN_LIMIT' | 'TEST_HOOKS'>,
	request: Request,
	suffix: string
): Promise<boolean> {
	if (!env.LOGIN_LIMIT || env.TEST_HOOKS === '1') return false;
	try {
		const { success } = await env.LOGIN_LIMIT.limit({ key: clientKey(request, suffix) });
		return !success;
	} catch {
		return false;
	}
}

/** One message for every refusal, silent about whether the account exists. */
export const TOO_MANY_MESSAGE = 'Too many tries just now. Wait a minute and try again.';
