import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	define: {
		// The build boundary for the /test/* hooks: true only in `vite dev`
		// and in builds run with TEST_HOOKS=1 (the e2e suite's build). A
		// plain `npm run build` folds this to false and the handlers drop
		// out of the worker, so in production the capability does not
		// exist at all, rather than existing switched off.
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
