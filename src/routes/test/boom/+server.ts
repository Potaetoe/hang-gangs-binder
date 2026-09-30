import { error, type RequestEvent } from '@sveltejs/kit';
import { requireTestHooks } from '$lib/server/test-hooks';

/** Test hook: throws on purpose, so the crash line (hooks.server.ts
 * handleError) can be fired and seen locally instead of trusted. */
function boom({ platform }: RequestEvent): never {
	requireTestHooks(platform!.env);
	throw new Error('test boom - the crash line you are reading proves handleError fires');
}

export const GET = __TEST_HOOKS__ ? boom : () => error(404, 'Not found');
