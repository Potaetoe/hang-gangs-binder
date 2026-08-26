import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession, SESSION_COOKIE } from '$lib/server/auth';

/** The rail's sign-out posts here from every page. A stray GET just
 * goes home. */
export const load: PageServerLoad = async () => {
	redirect(303, '/home');
};

export const actions: Actions = {
	default: async ({ cookies, platform }) => {
		await destroySession(getDb(platform!.env.DB), cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/');
	}
};
