import type { Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { sessionMember } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	event.locals.member = env
		? await sessionMember(getDb(env.DB), event.cookies.get('session'))
		: null;
	return resolve(event);
};
