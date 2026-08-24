/**
 * Secrets are set with `wrangler secret put` (WORKING.md, ops runbook)
 * so `wrangler types` cannot see them - this augmentation is where the
 * compiler learns they exist. Add a secret? It goes here AND in the
 * runbook's list, in the same commit.
 */
interface Env {
	ID_SECRET: string;
	DIRECTORY_SECRET: string;
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_BOT_USERNAME?: string;
	TELEGRAM_CHAT_ID?: string;
	TELEGRAM_ALLOW_IDS?: string;
	/** "1" only in local dev (.dev.vars) - enables the /test/* hooks. */
	TEST_HOOKS?: string;
	/** Declared in wrangler.jsonc, so it exists in production but not in
	 * local development. Optional on purpose: the throttle fails open
	 * when it is absent. */
	LOGIN_LIMIT?: RateLimit;
}
