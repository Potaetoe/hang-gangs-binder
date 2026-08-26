import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { SESSION_COOKIE, signInTelegram, TG_STATE_COOKIE, type Secrets } from '$lib/server/auth';
import { timingSafeEqual } from '$lib/server/crypto';

/** The login widget lands here (data-auth-url) with the signed fields
 * in the query string. */
export async function GET({ url, cookies, platform }: RequestEvent) {
	const env = platform!.env;
	// The state pair first (security review finding 3, login CSRF): the
	// door page put this value in a cookie and in the widget's return
	// URL. A crafted link cannot know the cookie, so it cannot land a
	// victim in an attacker's account. The cookie is burned either way.
	const stateParam = url.searchParams.get('state') ?? '';
	const stateCookie = cookies.get(TG_STATE_COOKIE) ?? '';
	cookies.delete(TG_STATE_COOKIE, { path: '/' });
	if (!stateParam || !stateCookie || !timingSafeEqual(stateParam, stateCookie)) {
		redirect(303, '/refused?why=stale-door');
	}
	const payload: Record<string, string> = {};
	// `state` is ours, not Telegram's: it must stay OUT of the payload,
	// because the signature check rebuilds Telegram's data-check string
	// from every field except `hash` and would never match with a field
	// Telegram did not sign.
	url.searchParams.forEach((value, key) => {
		if (key !== 'state') payload[key] = value;
	});

	const result = await signInTelegram(getDb(env.DB), env as unknown as Secrets, payload);
	if (!result.ok) {
		redirect(303, `/refused?why=${result.reason}`);
	}
	cookies.set(SESSION_COOKIE, result.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 30 * 86_400
	});
	redirect(303, '/home');
}
