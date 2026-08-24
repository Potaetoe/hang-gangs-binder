import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * The privacy model (DESIGN.md): rows are keyed by opaque member ids
 * that reverse to nobody. Identities live ONLY in `directory`, sealed
 * under a server secret. Sign-in lookups go through one-way scrambles,
 * so even the login table stores no plain identity.
 */

export const members = sqliteTable('members', {
	id: text('id').primaryKey(),
	// 'pending' until an admin approves (password registrations);
	// Telegram sign-ins arrive approved - the group bot check IS the
	// approval.
	status: text('status', { enum: ['pending', 'approved'] }).notNull(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull()
});

export const logins = sqliteTable('logins', {
	// HMAC of "telegram:<numeric id>" or "password:<username>" under
	// ID_SECRET - the only way a person is found, and one-way.
	lookupHash: text('lookup_hash').primaryKey(),
	memberId: text('member_id').notNull(),
	kind: text('kind', { enum: ['telegram', 'password'] }).notNull(),
	// PBKDF2 output for password logins, null for Telegram ones.
	passwordHash: text('password_hash'),
	createdAt: integer('created_at').notNull()
});

export const directory = sqliteTable('directory', {
	memberId: text('member_id').primaryKey(),
	// AES-GCM sealed JSON: { username?, displayName?, telegramId?,
	// handle? }. Opened only where a person must be shown to an admin
	// or greeted by name - never queried.
	sealed: text('sealed').notNull(),
	updatedAt: integer('updated_at').notNull()
});

export const sessions = sqliteTable('sessions', {
	// SHA-256 of the cookie token: a leaked table holds no usable
	// credential.
	tokenHash: text('token_hash').primaryKey(),
	memberId: text('member_id').notNull(),
	// Snapshot at sign-in; the admin surface re-checks when it matters.
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull(),
	expiresAt: integer('expires_at').notNull()
});
