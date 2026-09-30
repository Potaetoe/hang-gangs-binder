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

/*
 * The privacy model (DESIGN.md): rows are keyed by opaque member ids
 * that reverse to nobody. Names and links live only in sealed columns.
 * Every member-linked date is a calendar day, never a clock reading,
 * because a clock beside a member id is an activity log that can be
 * lined up against the group's chat.
 */

export const members = sqliteTable('members', {
	id: text('id').primaryKey(),
	// Password registrations wait for an admin. Telegram sign-ins arrive
	// approved: the group bot's membership check is the approval.
	status: text('status', { enum: ['pending', 'approved'] }).notNull(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull()
});

export const logins = sqliteTable('logins', {
	// HMAC of "telegram:<id>" or "password:<username>" under ID_SECRET,
	// so the table can find a person without storing who they are.
	lookupHash: text('lookup_hash').primaryKey(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id),
	kind: text('kind', { enum: ['telegram', 'password'] }).notNull(),
	passwordHash: text('password_hash'),
	// Set by an admin's temporary passphrase: the member must pick their
	// own password before anything else opens.
	mustChange: integer('must_change', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at').notNull()
});

/**
 * Spent Telegram login payloads. The payload rides in a URL, so burning
 * it on first use turns a captured link into a dead one.
 */
export const usedLogins = sqliteTable('used_logins', {
	hash: text('hash').primaryKey(),
	expiresAt: integer('expires_at').notNull()
});

/** Site-wide settings, one row per key; code defaults fill the gaps. */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/**
 * Every admin action writes a line. Members appear only as opaque ids
 * and are named at display time, so a purged member reads as departed.
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

/** The only place ids meet names, sealed under DIRECTORY_SECRET. */
export const directory = sqliteTable('directory', {
	memberId: text('member_id')
		.primaryKey()
		.references(() => members.id),
	sealed: text('sealed').notNull(),
	updatedAt: text('updated_at').notNull()
});

/**
 * The form is rows, not code, so a field an admin adds reaches the
 * member form and the chart filters without a deploy.
 */
export const fields = sqliteTable('fields', {
	// Seeded fields carry slugs ('height', 'weight', 'bmi') that code can
	// name; admin-made fields get random ids.
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	type: text('type', { enum: ['number', 'choice'] }).notNull(),
	// Decides the inputs and the conversion: ft+in / cm, lb / kg, or none.
	measure: text('measure', { enum: ['length', 'mass', 'plain'] }),
	// Marks BMI, the one recipe that can never be rewritten.
	computed: text('computed', { enum: ['bmi'] }),
	// A calculated field's recipe as JSON. Non-null is what makes a field
	// calculated, even before the recipe is finished.
	formula: text('formula'),
	options: text('options'),
	// One-way: several picks cannot be squeezed back into one.
	multiple: integer('multiple', { mode: 'boolean' }).notNull().default(false),
	position: integer('position').notNull(),
	// Retired fields leave the form; their history stays readable.
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
		date: text('date').notNull(),
		// Orders one member's same-day entries without a clock. Per member,
		// never global, or it would show who was active relative to whom.
		seq: integer('seq').notNull()
	},
	(t) => [
		index('entries_member_date').on(t.memberId, t.date, t.seq),
		// Two saves racing for one slot must fail, not both land.
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
		// Both systems are stored so charts never convert at read time.
		// Unitless numbers hold the same value in both.
		metric: real('metric'),
		imperial: real('imperial'),
		// What was typed, verbatim, for when rounding is in question.
		entered: text('entered'),
		choice: text('choice')
	},
	(t) => [
		primaryKey({ columns: [t.entryId, t.fieldId] }),
		index('entry_values_field').on(t.fieldId)
	]
);

/** Before-images of member corrections, kept for admin review. */
export const memberAudit = sqliteTable(
	'member_audit',
	{
		id: text('id').primaryKey(),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		date: text('date').notNull(),
		action: text('action', { enum: ['edit', 'delete'] }).notNull(),
		// Not a foreign key: the before-image must outlive a deleted entry.
		entryId: text('entry_id').notNull(),
		entryDate: text('entry_date').notNull(),
		before: text('before').notNull()
	},
	(t) => [index('member_audit_member').on(t.memberId)]
);

/** Group events. Admin-authored, with no link to who attended. */
export const events = sqliteTable(
	'events',
	{
		id: text('id').primaryKey(),
		date: text('date').notNull(),
		// A start time always carries its own zone; nothing is assumed.
		// No time means all day.
		time: text('time'),
		tz: text('tz'),
		title: text('title').notNull(),
		place: text('place'),
		notes: text('notes'),
		// Last day RSVPs are taken, inclusive. Null means the event's day.
		rsvpUntil: text('rsvp_until')
	},
	(t) => [index('events_date').on(t.date)]
);

/**
 * One row per interested member. No timestamp: when someone tapped is
 * an activity clock the binder does not keep.
 */
export const eventRsvps = sqliteTable(
	'event_rsvps',
	{
		eventId: text('event_id')
			.notNull()
			.references(() => events.id),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id)
	},
	(t) => [
		primaryKey({ columns: [t.eventId, t.memberId] }),
		index('event_rsvps_member').on(t.memberId)
	]
);

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
 * Image bytes in fixed-size chunks, so no row or bound parameter comes
 * near a D1 size limit. Written and read through the raw binding.
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

/** Member links. They identify people, so they are sealed like names. */
export const socials = sqliteTable('socials', {
	memberId: text('member_id')
		.primaryKey()
		.references(() => members.id),
	sealed: text('sealed').notNull(),
	updatedAt: text('updated_at').notNull()
});

/**
 * Failed sign-in counts per account, shared by every edge, so the
 * backoff holds globally. Keyed by the opaque lookup hash. Its clock is
 * real because a minute-scale backoff cannot run on days, and it only
 * ever records failures: success deletes the row.
 */
export const loginBackoff = sqliteTable('login_backoff', {
	lookupHash: text('lookup_hash').primaryKey(),
	fails: integer('fails').notNull(),
	blockedUntil: integer('blocked_until').notNull()
});

export const sessions = sqliteTable('sessions', {
	// A leaked table holds no usable token, only its hash.
	tokenHash: text('token_hash').primaryKey(),
	memberId: text('member_id')
		.notNull()
		.references(() => members.id),
	// Both expiries are rounded to a day boundary and nothing records
	// when a session began, so the table cannot say when anyone visited.
	expiresAt: integer('expires_at').notNull(),
	idleExpiresAt: integer('idle_expires_at').notNull().default(0)
});
