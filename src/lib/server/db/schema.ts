import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * The form is rows, not code (owner ruling 2026-08-24): admins will
 * own these through the form-builder feature, and a field they add
 * must reach the member form and the chart filters with no code
 * change. The starting fields are seeded by migration.
 */
export const fields = sqliteTable('fields', {
	// Seeded fields carry slug ids ('height'); admin-created ones get
	// random ids. The BMI computation finds height and weight by these
	// two slugs and quietly sits out if either is gone.
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type', { enum: ['number', 'choice'] }).notNull(),
	// For numbers: which measure, deciding the inputs and conversion.
	// length is ft+in / cm, mass is lb / kg, plain has no units.
	measure: text('measure', { enum: ['length', 'mass', 'plain'] }),
	// 'bmi' marks the computed field - nothing is ever typed into it.
	computed: text('computed', { enum: ['bmi'] }),
	// JSON string[] for choice fields.
	options: text('options'),
	position: integer('position').notNull(),
	// Retired fields leave the form but their history stays readable.
	status: text('status', { enum: ['active', 'retired'] })
		.notNull()
		.default('active')
});

export const entries = sqliteTable(
	'entries',
	{
		id: text('id').primaryKey(),
		memberId: text('member_id').notNull(),
		// Date only, never clock time (owner ruling 2026-08-24): a stored
		// timestamp would let a leaked copy match rows to chat activity.
		date: text('date').notNull(),
		// Per-member counter ordering a day's entries without a clock. Not
		// global on purpose - a global order would leak who was active
		// relative to whom.
		seq: integer('seq').notNull()
	},
	(t) => [index('entries_member_date').on(t.memberId, t.date, t.seq)]
);

export const entryValues = sqliteTable(
	'entry_values',
	{
		entryId: text('entry_id').notNull(),
		fieldId: text('field_id').notNull(),
		// Numbers carry both systems (owner ruling: charts read either
		// without converting). Unitless numbers store the same value in
		// both columns.
		metric: real('metric'),
		imperial: real('imperial'),
		// Exactly what was typed, verbatim with its unit - the honest
		// record when rounding argues (carried from the old world).
		entered: text('entered'),
		choice: text('choice')
	},
	(t) => [
		primaryKey({ columns: [t.entryId, t.fieldId] }),
		// The charts (build order step 3) aggregate by field.
		index('entry_values_field').on(t.fieldId)
	]
);

/**
 * Member corrections, kept for admin review (owner ruling 2026-08-24)
 * - separate from the step-4 admin change log. Same date-only rule as
 * entries.
 */
export const memberAudit = sqliteTable(
	'member_audit',
	{
		id: text('id').primaryKey(),
		memberId: text('member_id').notNull(),
		date: text('date').notNull(),
		action: text('action', { enum: ['edit', 'delete'] }).notNull(),
		entryId: text('entry_id').notNull(),
		entryDate: text('entry_date').notNull(),
		// JSON snapshot of the entry's values before the change.
		before: text('before').notNull()
	},
	(t) => [index('member_audit_member').on(t.memberId)]
);

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
