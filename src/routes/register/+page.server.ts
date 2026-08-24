import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { PASSWORD_MIN, register, type Secrets } from '$lib/server/auth';
import { TOO_MANY_MESSAGE, tooManyAttempts } from '$lib/server/throttle';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.member) redirect(303, '/home');
	// The box's own minimum comes from the server's, so the two cannot
	// drift apart the way they did before the security pass.
	return { passwordMin: PASSWORD_MIN };
};

const MESSAGES = {
	'bad-username': 'A username is 3 to 32 characters: lowercase letters, digits and underscores.',
	'bad-password': `A password is at least ${PASSWORD_MIN} characters.`,
	'breached-password':
		'That password turns up in known password leaks, so it is already being guessed. Pick another one.',
	'username-taken': 'That username is taken.'
} as const;

export const actions: Actions = {
	register: async ({ request, platform }) => {
		const env = platform!.env;
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const displayName = String(form.get('displayName') ?? '');

		// This form answers "is that name taken?", which is a roster
		// oracle for a private group. Nobody registers six times a
		// minute; a script checking a list of handles does.
		if (await tooManyAttempts(env, request, 'register')) {
			return fail(429, { username, displayName, message: TOO_MANY_MESSAGE });
		}

		const result = await register(
			getDb(env.DB),
			env as unknown as Secrets,
			username,
			String(form.get('password') ?? ''),
			displayName
		);
		if (!result.ok) {
			return fail(400, { username, displayName, message: MESSAGES[result.reason] });
		}
		return { registered: true };
	}
};
