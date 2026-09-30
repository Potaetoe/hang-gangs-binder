import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// A fresh local database every run: wiped, migrated, then served.
		command: 'npm run db:wipe:local && npm run db:apply:local && npm run build && npm run preview',
		// Compiles the /test/* hooks into this build only (vite.config.ts).
		env: { TEST_HOOKS: '1' },
		port: 4173,
		timeout: 180_000
	},
	// A kept trace names the failing line and what the page held, even
	// after the next run overwrites test-results. No retries: a flaky
	// test should fail loudly, not quietly pass on the second try.
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	projects: [
		// The purge test runs first and alone. Mid-test its member holds a
		// socials row while the socials spec expects an empty roster, so
		// run together they race.
		{ name: 'purge', testMatch: '**/purge.e2e.{ts,js}' },
		{
			name: 'features',
			testMatch: '**/*.e2e.{ts,js}',
			testIgnore: '**/purge.e2e.{ts,js}',
			dependencies: ['purge']
		}
	]
});
