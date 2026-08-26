import {
	blob,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

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
	// Day only, like every other member-linked timestamp here. A clock
	// reading beside a member id is an activity log, and one that can be
	// lined up against the group's chat (security pass, 2026-08-24).
	createdAt: text('created_at').notNull()
});

export const logins = sqliteTable('logins', {
	// HMAC of "telegram:<numeric id>" or "password:<username>" under
	// ID_SECRET - the only way a person is found, and one-way.
	lookupHash: text('lookup_hash').primaryKey(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id),
	kind: text('kind', { enum: ['telegram', 'password'] }).notNull(),
	// PBKDF2 output for password logins, null for Telegram ones.
	passwordHash: text('password_hash'),
	// Set when an admin hands out a temporary passphrase: the next
	// sign-in is walled off until the member picks their own password.
	mustChange: integer('must_change', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull()
});

/**
 * Telegram login payloads already spent. The widget's signed payload
 * rides in a URL, so a captured link used to be a working key until
 * its window closed; burning the hash on first use makes it good
 * exactly once (security pass, 2026-08-24). Rows are swept as they
 * expire - nothing here is linked to a member.
 */
export const usedLogins = sqliteTable('used_logins', {
	hash: text('hash').primaryKey(),
	expiresAt: integer('expires_at').notNull()
});

/**
 * Site-wide settings, written by admins (owner ruling 2026-08-24):
 * one row per key, read with code defaults when absent. Keys today:
 * site_name, welcome_text, timezone, theme.
 */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/**
 * The admin change log (DESIGN.md "Admin surface"): every admin action
 * writes a line. Day-only dates, like everything else. Members are
 * named by their opaque ids; the page unseals names at display time,
 * so a purged member simply reads as departed.
 */
export const adminLog = sqliteTable(
	'admin_log',
	{
		id: text('id').primaryKey(),
		date: text('date').notNull(),
		actorId: text('actor_id').notNull(),
		action: text('action').notNull(),
		subjectId: text('subject_id'),
		detail: text('detail')
	},
	(t) => [index('admin_log_date').on(t.date)]
);

export const directory = sqliteTable('directory', {
	memberId: text('member_id')
		.primaryKey()
		.references(() => members.id),
	// AES-GCM sealed JSON: { username?, displayName?, telegramId?,
	// handle? }. Opened only where a person must be shown to an admin
	// or greeted by name - never queried.
	sealed: text('sealed').notNull(),
	// Day only. This one sat ON the sealed row: the blob was encrypted,
	// but its own metadata announced the second its owner last used the
	// Telegram door (security pass, 2026-08-24).
	updatedAt: text('updated_at').notNull()
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
	// 'bmi' marks the one locked recipe - still essential, formula
	// fixed (owner ruling 2026-08-26); nothing is ever typed into it.
	computed: text('computed', { enum: ['bmi'] }),
	// Calculated fields (DESIGN.md feature 7): JSON {start, steps,
	// units, decimals} - the guided builder's chain, worked left to
	// right at save time. Non-null IS what makes a field calculated;
	// BMI carries the locked version.
	formula: text('formula'),
	// JSON string[] for choice fields.
	options: text('options'),
	// Pick-several choice fields: members tick checkboxes and the
	// stored value is a JSON string[] in entry_values.choice. Flipping
	// this on is one-way (owner ruling 2026-08-24) - old single answers
	// read as one-item picks, but several picks cannot become one.
	multiple: integer('multiple', { mode: 'boolean' }).notNull().default(false),
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
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		// Date only, never clock time (owner ruling 2026-08-24): a stored
		// timestamp would let a leaked copy match rows to chat activity.
		date: text('date').notNull(),
		// Per-member counter ordering a day's entries without a clock. Not
		// global on purpose - a global order would leak who was active
		// relative to whom.
		seq: integer('seq').notNull()
	},
	(t) => [
		index('entries_member_date').on(t.memberId, t.date, t.seq),
		// seq is the ordering contract, so it is UNIQUE per member
		// (hardening pass, 2026-08-26): two saves racing over one slot
		// now error instead of both landing.
		uniqueIndex('entries_member_seq').on(t.memberId, t.seq)
	]
);

export const entryValues = sqliteTable(
	'entry_values',
	{
		entryId: text('entry_id')
			.notNull()
			.references(() => entries.id),
		fieldId: text('field_id')
			.notNull()
			.references(() => fields.id),
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
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		date: text('date').notNull(),
		action: text('action', { enum: ['edit', 'delete'] }).notNull(),
		// Deliberately NOT a foreign key: the before-image outlives a
		// deleted entry - that is its whole job.
		entryId: text('entry_id').notNull(),
		entryDate: text('entry_date').notNull(),
		// JSON snapshot of the entry's values before the change.
		before: text('before').notNull()
	},
	(t) => [index('member_audit_member').on(t.memberId)]
);

/**
 * Group events (DESIGN.md feature 5, owner rulings 2026-08-26):
 * admin-authored, no member linkage anywhere - an event names a day
 * the group meets, never who was there. The date is the event's own
 * day, not an activity timestamp.
 */
export const events = sqliteTable(
	'events',
	{
		id: text('id').primaryKey(),
		date: text('date').notNull(),
		// Optional start time (HH:MM) with its EXPLICIT zone (owner
		// rulings 2026-08-26): the admin picks both, nothing is assumed.
		// Null time = an all-day event, which is also what every event
		// from before times existed reads as. Members see the time in
		// their own clock - the page converts, the row never does.
		time: text('time'),
		tz: text('tz'),
		title: text('title').notNull(),
		place: text('place'),
		notes: text('notes')
	},
	(t) => [index('events_date').on(t.date)]
);

/** An event's gallery, one row per image; the bytes live in chunks. */
export const eventImages = sqliteTable(
	'event_images',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id),
		position: integer('position').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull()
	},
	(t) => [index('event_images_event').on(t.eventId)]
);

/**
 * Image bytes, split into fixed-size chunks so no single row or bound
 * parameter ever nears a D1 limit, whatever that limit turns out to
 * be. Read and written through the raw D1 binding (events.ts) - the
 * query builder never touches the bytes.
 */
export const eventImageChunks = sqliteTable(
	'event_image_chunks',
	{
		imageId: text('image_id')
			.notNull()
			.references(() => eventImages.id),
		seq: integer('seq').notNull(),
		bytes: blob('bytes').notNull()
	},
	(t) => [primaryKey({ columns: [t.imageId, t.seq] })]
);

/**
 * Member socials (DESIGN.md feature 6, owner rulings 2026-08-26):
 * links are real identities, so they live sealed exactly like names -
 * a leaked copy shows nothing. One row per member who has added
 * links; deleting the row is what removes them. Every payload is
 * pre-padded into one fixed bucket before sealing, so even the count
 * of someone's links leaks nothing.
 */
export const socials = sqliteTable('socials', {
	memberId: text('member_id')
		.primaryKey()
		.references(() => members.id),
	sealed: text('sealed').notNull(),
	// Day only, like every member-linked timestamp.
	updatedAt: text('updated_at').notNull()
});

/**
 * Global sign-in backoff (security review finding 9, owner ruling
 * 2026-08-26): failure counts per account, kept in the one database so
 * the limit holds across every edge - the per-edge limiter stays as
 * the outer layer. Keyed by the same opaque lookup hash as logins,
 * never a plain username. A row exists only while an account is being
 * failed at: success deletes it, and a quiet day decays it.
 */
export const loginBackoff = sqliteTable('login_backoff', {
	lookupHash: text('lookup_hash').primaryKey(),
	fails: integer('fails').notNull(),
	// A real clock, deliberately - minute-scale backoff cannot be
	// enforced day-granular. It marks FAILED tries only; nothing about
	// a successful visit ever lands here.
	blockedUntil: integer('blocked_until').notNull()
});

export const sessions = sqliteTable('sessions', {
	// SHA-256 of the cookie token: a leaked table holds no usable
	// credential.
	tokenHash: text('token_hash').primaryKey(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id),
	// The dead is_admin snapshot column left here (fix pass 2026-08-25)
	// was dropped by the hardening migration, 2026-08-26 - authority
	// lives on the member row alone, read fresh every request.
	// Expiry has to be a real number to enforce, but it is rounded to a
	// day boundary and there is no created_at beside it - this table
	// used to be a 30-day, second-resolution record of when each member
	// signed in (security pass, 2026-08-24).
	expiresAt: integer('expires_at').notNull(),
	// The idle clock (owner ruling 2026-08-26, security review finding
	// 5): a session unused for 7 days dies. Slid forward as it is used,
	// but only ever to a day boundary - "alive as of day X" is the
	// finest thing this table may record about a member's visits.
	idleExpiresAt: integer('idle_expires_at').notNull().default(0)
});
