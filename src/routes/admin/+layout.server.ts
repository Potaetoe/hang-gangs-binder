import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Admins only; everyone else is quietly sent home. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return {};
};
