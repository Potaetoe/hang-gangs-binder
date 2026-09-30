import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import {
	setSessionCookie,
	signInPassword,
	TG_STATE_COOKIE,
	TOO_MANY_MESSAGE,
	tooManyAttempts
} from '$lib/server/auth';
import { randomToken } from '$lib/server/crypto';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (locals.member) redirect(303, '/home');
	// Without the bot's public username the Telegram door says it is not
	// set up, instead of rendering a broken button.
	const telegramBot = platform?.env.TELEGRAM_BOT_USERNAME || null;
	let tgState: string | null = null;
	if (telegramBot) {
		tgState = randomToken(16);
		// Lax, because the return from oauth.telegram.org is a cross-site
		// top-level navigation and Lax cookies ride on those.
		cookies.set(TG_STATE_COOKIE, tgState, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 600
		});
	}
	return { telegramBot, tgState };
};

export const actions: Actions = {
	signin: async ({ request, cookies, platform }) => {
		const env = platform!.env;
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		// Before the password is checked, so a refused try costs no hashing.
		if (await tooManyAttempts(env, request, 'signin')) {
			return fail(429, { username, message: TOO_MANY_MESSAGE });
		}
		const result = await signInPassword(
			getDb(env.DB),
			env,
			username,
			String(form.get('password') ?? '')
		);
		if (result.ok) {
			setSessionCookie(cookies, result.token);
			redirect(303, '/home');
		}
		// The backoff wears the throttle's words: one message for every
		// slow-down, silent about who exists.
		if (result.reason === 'throttled') return fail(429, { username, message: TOO_MANY_MESSAGE });
		return fail(400, {
			username,
			message:
				result.reason === 'pending'
					? 'Your account is waiting for an admin to approve it.'
					: 'That username and password did not match.'
		});
	}
};
