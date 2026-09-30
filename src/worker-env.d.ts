/** True in `vite dev` and in builds run with TEST_HOOKS=1; false in a
 * plain production build, which drops the /test/* handlers entirely
 * (vite.config.ts). */
declare const __TEST_HOOKS__: boolean;

/**
 * Secrets set with `wrangler secret put` are invisible to `wrangler
 * types`, so this is where the compiler learns they exist. A new secret
 * goes here and in the runbook's list, in the same commit.
 */
interface Env {
	ID_SECRET: string;
	DIRECTORY_SECRET: string;
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_BOT_USERNAME?: string;
	TELEGRAM_CHAT_ID?: string;
	TELEGRAM_ALLOW_IDS?: string;
	/** "1" only in local dev and the test suite. */
	TEST_HOOKS?: string;
	/** Missing in local development, so the throttle fails open there. */
	LOGIN_LIMIT?: RateLimit;
}
