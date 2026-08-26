import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { imageResponse } from '$lib/server/events';

/** An event image, streamed chunk by chunk. Members only - to anyone
 * else the URL is a plain 404, admitting nothing. */
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.member) error(404, 'Not found');
	const env = platform!.env;
	return imageResponse(getDb(env.DB), env.DB, params.id);
};
