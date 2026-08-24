import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession } from '$lib/server/auth';

/** The rail's sign-out posts here from every page. A stray GET just
 * goes home. */
export const load: PageServerLoad = async () => {
	redirect(303, '/home');
};

export const actions: Actions = {
	default: async ({ cookies, platform }) => {
		await destroySession(getDb(platform!.env.DB), cookies.get('session'));
		cookies.delete('session', { path: '/' });
		redirect(303, '/');
	}
};
