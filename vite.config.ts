import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	define: {
		// The build boundary for the /test/* hooks (SECURITY-REVIEW.md
		// finding 2): true only in `vite dev` and in builds run with
		// TEST_HOOKS=1 in the shell (the e2e suite's build, via
		// playwright.config.ts). A plain `npm run build` folds this to
		// false and the hook handlers tree-shake out of the worker -
		// the capability does not exist in production, rather than
		// existing switched off.
		__TEST_HOOKS__: JSON.stringify(command === 'serve' || process.env.TEST_HOOKS === '1')
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
					// Keep svelte-check out of build output: without
					// these, a local run after any build drowns real
					// errors in hundreds from the compiled _worker.js.
					config.exclude.push(
						'../.svelte-kit/cloudflare/**',
						'../.svelte-kit/output/**',
						'../.wrangler/**'
					);
				}
			}
		})
	]
}));
