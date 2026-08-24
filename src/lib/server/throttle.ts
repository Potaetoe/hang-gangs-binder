/**
 * Brute-force defence for the two forms that take a password (security
 * pass, 2026-08-24). Nothing used to slow down guessing at all: an
 * attacker could sit on the sign-in form and try passwords as fast as
 * the network allowed.
 *
 * Cloudflare's dashboard rate-limiting rules are scoped to a domain,
 * and this site answers on a workers.dev address, which is not a
 * domain we own - so the limit lives in the Worker, which works
 * either way and costs nothing.
 */

/** Cloudflare's own header, set at the edge; a client cannot forge it
 * into a request that reaches us, so it is safe as the key. */
export function clientKey(request: Request, suffix: string): string {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	return `${suffix}:${ip}`;
}

/**
 * True when this attempt should be refused. Fails OPEN in three cases,
 * on purpose: no binding (local development and the test suite), the
 * test flag being set, or the limiter itself erroring. A limiter that
 * locks the group out of their own binder because of an internal fault
 * is worse than one that occasionally lets a guess through.
 */
export async function tooManyAttempts(
	env: Env | undefined,
	request: Request,
	suffix: string
): Promise<boolean> {
	if (!env?.LOGIN_LIMIT || env.TEST_HOOKS === '1') return false;
	try {
		const { success } = await env.LOGIN_LIMIT.limit({ key: clientKey(request, suffix) });
		return !success;
	} catch {
		return false;
	}
}

/** One message for every refusal, and it never says whether the
 * account exists - the same discretion the sign-in answer keeps. */
export const TOO_MANY_MESSAGE = 'Too many tries just now. Wait a minute and try again.';
