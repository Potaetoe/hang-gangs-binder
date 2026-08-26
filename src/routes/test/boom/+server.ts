import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * TEST HOOK, dead in production (TEST_HOOKS is only set in .dev.vars,
 * like /test/approve): throws on purpose, so the crash-line logging
 * (hooks.server.ts handleError) can be fired and SEEN locally instead
 * of trusted. The next real outage is not the right first test.
 */
export function GET({ platform }: RequestEvent) {
	if (platform!.env.TEST_HOOKS !== '1') error(404, 'Not found');
	throw new Error('test boom - the crash line you are reading proves handleError fires');
}
