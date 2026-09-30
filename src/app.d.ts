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
			/** Lets the palette's one inline <style> past the CSP. */
			cspNonce: string;
		}
	}
}

export {};
