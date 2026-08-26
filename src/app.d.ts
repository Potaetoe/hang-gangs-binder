// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			member: { memberId: string; isAdmin: boolean; mustChange: boolean } | null;
			/** Per-request CSP nonce; the layout stamps it on the one
			 * inline <style> (security review finding 7). */
			cspNonce: string;
		}
	}
}

export {};
