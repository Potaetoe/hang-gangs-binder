import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { changePassword } from '$lib/server/auth';
import { sha256Hex } from '$lib/server/crypto';

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

		const result = await changePassword(
			getDb(platform!.env.DB),
			locals.member.memberId,
			current,
			next,
			await sha256Hex(token)
		);
		if (!result.ok) {
			return fail(400, {
				message:
					result.reason === 'wrong'
						? 'The current password did not match.'
						: result.reason === 'bad-password'
							? 'A password needs 8 to 128 characters.'
							: 'This account has no password door.'
			});
		}
		redirect(303, '/home');
	}
};
