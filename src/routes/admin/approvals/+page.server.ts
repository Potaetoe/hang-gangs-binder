import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Approvals live on the Members page now (owner, 2026-08-24); the
 * old address keeps working. */
export const load: PageServerLoad = async () => {
	redirect(303, '/admin/members');
};
