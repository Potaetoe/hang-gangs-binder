import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// A fresh local database every run (owner grant 2026-08-24:
		// test data is disposable) - wiped, migrated, then served.
		command: 'npm run db:wipe:local && npm run db:apply:local && npm run build && npm run preview',
		port: 4173,
		timeout: 180_000
	},
	use: { baseURL: 'http://localhost:4173' },
	testMatch: '**/*.e2e.{ts,js}'
});
