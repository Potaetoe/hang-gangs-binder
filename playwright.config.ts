import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// A fresh local database every run (owner grant 2026-08-24:
		// test data is disposable) - wiped, migrated, then served.
		command: 'npm run db:wipe:local && npm run db:apply:local && npm run build && npm run preview',
		// Build-time flag (vite.config.ts): compiles the /test/* hooks
		// into THIS build. A plain `npm run build` leaves them out.
		env: { TEST_HOOKS: '1' },
		port: 4173,
		timeout: 180_000
	},
	// retain-on-failure: a one-off flake on 2026-08-26 left nothing to
	// read because test-results was overwritten by the next run. A
	// trace survives to name the failing line and what the page held.
	// No retries, on purpose - a flaky test should fail loudly, not
	// quietly pass on the second try.
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	projects: [
		// The purge test runs FIRST and ALONE (hardening pass,
		// 2026-08-26): mid-test its member holds a socials row, and the
		// socials spec asserts an empty roster - run together they race.
		// By the time the parallel pack starts, the purge has swept its
		// own tracks.
		{ name: 'purge', testMatch: '**/purge.e2e.{ts,js}' },
		{
			name: 'features',
			testMatch: '**/*.e2e.{ts,js}',
			testIgnore: '**/purge.e2e.{ts,js}',
			dependencies: ['purge']
		}
	]
});
