import { redirect, type Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { sessionMember } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	event.locals.member = env
		? await sessionMember(getDb(env.DB), event.cookies.get('session'))
		: null;
	// A temporary passphrase walls the whole site off until the member
	// picks their own password (owner ruling 2026-08-24).
	const path = event.url.pathname;
	if (
		event.locals.member?.mustChange &&
		!path.startsWith('/password') &&
		!path.startsWith('/signout')
	) {
		redirect(303, '/password');
	}
	return resolve(event);
};
