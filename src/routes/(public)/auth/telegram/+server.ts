import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { setSessionCookie, signInTelegram, TG_STATE_COOKIE } from '$lib/server/auth';
import { timingSafeEqual } from '$lib/server/crypto';

/** Telegram's login widget lands here with its signed fields in the
 * query string. */
export const GET: RequestHandler = async ({ url, cookies, platform }) => {
	const env = platform!.env;
	// The state cookie is burned either way, so each door visit is good
	// for one return.
	const stateParam = url.searchParams.get('state') ?? '';
	const stateCookie = cookies.get(TG_STATE_COOKIE) ?? '';
	cookies.delete(TG_STATE_COOKIE, { path: '/' });
	if (!stateParam || !stateCookie || !timingSafeEqual(stateParam, stateCookie)) {
		redirect(303, '/refused?why=stale-door');
	}
	// `state` is ours, not Telegram's. Left in, it would break the
	// signature check, which rebuilds the signed string from every field.
	const payload: Record<string, string> = {};
	url.searchParams.forEach((value, key) => {
		if (key !== 'state') payload[key] = value;
	});

	const result = await signInTelegram(getDb(env.DB), env, payload);
	if (!result.ok) redirect(303, `/refused?why=${result.reason}`);
	setSessionCookie(cookies, result.token);
	redirect(303, '/home');
};
