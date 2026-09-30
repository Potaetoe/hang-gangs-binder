import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import {
	BREACHED_MESSAGE,
	changePassword,
	PASSWORD_MAX,
	PASSWORD_MIN,
	SESSION_COOKIE,
	TOO_MANY_MESSAGE,
	tooManyAttempts
} from '$lib/server/auth';
import { sha256Hex } from '$lib/server/crypto';

export const load: PageServerLoad = async ({ locals }) => ({ forced: locals.member!.mustChange });

const MESSAGES = {
	wrong: 'The current password did not match.',
	'bad-password': `A password needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`,
	'breached-password': BREACHED_MESSAGE,
	'no-password-door': 'This account has no password sign-in.'
} as const;

export const actions: Actions = {
	change: async ({ request, locals, platform, cookies }) => {
		const env = platform!.env;
		const form = await request.formData();
		// This checks a password like the sign-in door does, so it gets the
		// same brake: a stolen session must not grind at it full speed.
		if (await tooManyAttempts(env, request, 'password')) {
			return fail(429, { message: TOO_MANY_MESSAGE });
		}
		const result = await changePassword(
			getDb(env.DB),
			env,
			locals.member!.memberId,
			String(form.get('current') ?? ''),
			String(form.get('next') ?? ''),
			await sha256Hex(cookies.get(SESSION_COOKIE) ?? '')
		);
		if (!result.ok) return fail(400, { message: MESSAGES[result.reason] });
		redirect(303, '/home');
	}
};
