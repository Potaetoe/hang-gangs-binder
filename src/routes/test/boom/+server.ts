import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireTestHooks } from '$lib/server/test-hooks';

/**
 * TEST HOOK, absent from production: a plain build tree-shakes the
 * handler away (`__TEST_HOOKS__`, vite.config.ts) and only the 404
 * below remains; in test builds the runtime TEST_HOOKS guard still
 * gates it. Throws on purpose, so the crash-line logging
 * (hooks.server.ts handleError) can be fired and SEEN locally instead
 * of trusted. The next real outage is not the right first test.
 */
function boom({ platform }: RequestEvent): never {
	requireTestHooks(platform!.env);
	throw new Error('test boom - the crash line you are reading proves handleError fires');
}

export const GET = __TEST_HOOKS__ ? boom : () => error(404, 'Not found');
