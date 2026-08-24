import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { signInTelegram, type Secrets } from '$lib/server/auth';

/** The login widget lands here (data-auth-url) with the signed fields
 * in the query string. */
export async function GET({ url, cookies, platform }: RequestEvent) {
	const env = platform!.env;
	const payload: Record<string, string> = {};
	url.searchParams.forEach((value, key) => (payload[key] = value));

	const result = await signInTelegram(getDb(env.DB), env as unknown as Secrets, payload);
	if (!result.ok) {
		redirect(303, `/refused?why=${result.reason}`);
	}
	cookies.set('session', result.token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 30 * 86_400
	});
	redirect(303, '/home');
}
