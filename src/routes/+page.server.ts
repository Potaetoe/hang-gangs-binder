import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { SESSION_COOKIE, signInPassword, TG_STATE_COOKIE, type Secrets } from '$lib/server/auth';
import { randomToken } from '$lib/server/crypto';
import { TOO_MANY_MESSAGE, tooManyAttempts } from '$lib/server/throttle';

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (locals.member) redirect(303, '/home');
	const telegramBot = platform?.env.TELEGRAM_BOT_USERNAME ?? null;
	// The state pair (finding 3): a fresh random value on every door
	// render, in a short-lived cookie AND in the widget's return URL.
	// SameSite lax on purpose - the return from oauth.telegram.org is a
	// cross-site top-level navigation, and Lax cookies ride on those.
	let tgState: string | null = null;
	if (telegramBot) {
		tgState = randomToken(16);
		cookies.set(TG_STATE_COOKIE, tgState, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 600
		});
	}
	return {
		// The widget needs the bot's public username; without it the
		// Telegram door renders as "not set up yet" instead of a broken
		// button.
		telegramBot,
		tgState
	};
};

export const actions: Actions = {
	signin: async ({ request, cookies, platform }) => {
		const env = platform!.env;
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const password = String(form.get('password') ?? '');

		// Checked BEFORE the password is, so a refused attempt costs an
		// attacker a round trip and costs us no hashing at all.
		if (await tooManyAttempts(env, request, 'signin')) {
			return fail(429, { username, message: TOO_MANY_MESSAGE });
		}

		const result = await signInPassword(
			getDb(env.DB),
			env as unknown as Secrets,
			username,
			password
		);
		if (!result.ok) {
			// The backoff's refusal wears the throttle's words - one
			// message for every slow-down, silent about who exists.
			if (result.reason === 'throttled') {
				return fail(429, { username, message: TOO_MANY_MESSAGE });
			}
			return fail(400, {
				username,
				message:
					result.reason === 'pending'
						? 'Your account is waiting for an admin to approve it.'
						: 'That username and password did not match.'
			});
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
};
