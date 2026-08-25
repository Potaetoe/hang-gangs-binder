import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { changePassword, PASSWORD_MAX, PASSWORD_MIN } from '$lib/server/auth';
import { sha256Hex } from '$lib/server/crypto';
import { TOO_MANY_MESSAGE, tooManyAttempts } from '$lib/server/throttle';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.member) redirect(303, '/');
	return { forced: locals.member.mustChange };
};

export const actions: Actions = {
	change: async ({ request, locals, platform, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		const current = String(form.get('current') ?? '');
		const next = String(form.get('next') ?? '');
		const token = cookies.get('session');
		if (!token) redirect(303, '/');

		// This form verifies a password, same as the sign-in door - so it
		// holds to the same throttle (fix pass 2026-08-25). It used to be
		// the one password check with no brake on guessing: a stolen
		// session could grind at the current password full speed.
		if (await tooManyAttempts(platform!.env, request, 'password')) {
			return fail(429, { message: TOO_MANY_MESSAGE });
		}

		const result = await changePassword(
			getDb(platform!.env.DB),
			locals.member.memberId,
			current,
			next,
			await sha256Hex(token),
			platform!.env.TEST_HOOKS === '1'
		);
		if (!result.ok) {
			return fail(400, {
				message:
					result.reason === 'wrong'
						? 'The current password did not match.'
						: result.reason === 'bad-password'
							? `A password needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`
							: result.reason === 'breached-password'
								? 'That password turns up in known password leaks, so it is already being guessed. Pick another one.'
								: 'This account has no password sign-in.'
			});
		}
		redirect(303, '/home');
	}
};
