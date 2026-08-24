import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { signInPassword, type Secrets } from '$lib/server/auth';
import { TOO_MANY_MESSAGE, tooManyAttempts } from '$lib/server/throttle';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.member) redirect(303, '/home');
	return {
		// The widget needs the bot's public username; without it the
		// Telegram door renders as "not set up yet" instead of a broken
		// button.
		telegramBot: platform?.env.TELEGRAM_BOT_USERNAME ?? null
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
			return fail(400, {
				username,
				message:
					result.reason === 'pending'
						? 'Your account is waiting for an admin to approve it.'
						: 'That username and password did not match.'
			});
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
};
