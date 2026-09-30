import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { imageResponse } from '$lib/server/events';

/** Members only. To anyone else the URL is a plain 404 that admits
 * nothing, not a redirect to a sign-in page. */
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.member) error(404, 'Not found');
	const env = platform!.env;
	return imageResponse(getDb(env.DB), env.DB, params.id);
};
