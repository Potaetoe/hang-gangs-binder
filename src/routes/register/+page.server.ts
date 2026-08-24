import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { register, type Secrets } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.member) redirect(303, '/home');
};

const MESSAGES = {
	'bad-username':
		'A username is 3 to 32 characters: lowercase letters, digits and underscores.',
	'bad-password': 'A password is at least 8 characters.',
	'username-taken': 'That username is taken.'
} as const;

export const actions: Actions = {
	register: async ({ request, platform }) => {
		const env = platform!.env;
		const form = await request.formData();
		const username = String(form.get('username') ?? '');
		const displayName = String(form.get('displayName') ?? '');

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
