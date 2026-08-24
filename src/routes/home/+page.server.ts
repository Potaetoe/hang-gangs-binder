import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession, identityOf, type Secrets } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.member) redirect(303, '/');
	const env = platform!.env;
	const identity = await identityOf(
		getDb(env.DB),
		env as unknown as Secrets,
		locals.member.memberId
	);
	return {
		name: identity.displayName || identity.username || identity.handle || 'member',
		isAdmin: locals.member.isAdmin
	};
};

export const actions: Actions = {
	signout: async ({ cookies, platform }) => {
		const env = platform!.env;
		await destroySession(getDb(env.DB), cookies.get('session'));
		cookies.delete('session', { path: '/' });
		redirect(303, '/');
	}
};
