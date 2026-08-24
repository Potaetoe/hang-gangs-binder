import { defineConfig } from 'drizzle-kit';

// Migrations are generated offline (`npm run db:generate`) and applied
// with wrangler (`wrangler d1 migrations apply binder-db`), so this
// config needs no Cloudflare credentials. `db:push`/`db:studio` would -
// we do not use them; the migration files are the only schema channel
// (WORKING.md, ops runbook).
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	verbose: true,
	strict: true
});
