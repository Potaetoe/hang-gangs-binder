/**
 * Group events (DESIGN.md feature 5, owner rulings 2026-08-26): the
 * calendar card's data, the admin section's actions, and the image
 * gallery. Events are admin-authored group data with no member
 * linkage - nothing here touches a member id.
 *
 * Image bytes live in fixed-size chunks (schema.ts) written and read
 * through the raw D1 binding, so no bound parameter or result row
 * ever nears a D1 size limit. The cap per image is the price of
 * keeping a fork one database (owner ruling 2026-08-26).
 */

import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import { runBatch } from './db';
import { randomToken } from './crypto';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export type EventRow = typeof table.events.$inferSelect;
export type EventImageRow = typeof table.eventImages.$inferSelect;

/* ---------------------------------------------------------------- */
/* The rulings as numbers                                            */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_EVENT = 8;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const CHUNK_BYTES = 256 * 1024;

export const TITLE_MAX = 80;
export const PLACE_MAX = 120;
export const NOTES_MAX = 2000;

/** The home page shows this many events at a time (owner ruling
 * 2026-08-26): a row of three with a pager for the rest. */
export const EVENTS_PER_PAGE = 3;

/* ---------------------------------------------------------------- */
/* Validation                                                        */

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_SHAPE = /^\d{4}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** A string that is really a calendar day: right shape, and the date
 * round-trips (2026-02-31 does not). */
export function validDay(date: string): boolean {
	if (!DATE_SHAPE.test(date)) return false;
	const [y, m, d] = date.split('-').map(Number);
	const utc = new Date(Date.UTC(y, m - 1, d));
	return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

export type EventFields = {
	date: string;
	time: string | null;
	tz: string | null;
	title: string;
	place: string | null;
	notes: string | null;
};

/** Reads the shared title/date/time/place/notes inputs; every fault
 * at once, like the entry form. Time is optional (owner ruling
 * 2026-08-26: an event without one is all-day); a time must bring
 * its zone - nothing is assumed. */
export function parseEventFields(
	form: FormData
): { ok: true; fields: EventFields } | { ok: false; problems: string[] } {
	const problems: string[] = [];
	const title = String(form.get('title') ?? '').trim();
	const date = String(form.get('date') ?? '').trim();
	const time = String(form.get('time') ?? '').trim();
	const tz = String(form.get('tz') ?? '').trim();
	const place = String(form.get('place') ?? '').trim();
	const notes = String(form.get('notes') ?? '').trim();
	if (!title) problems.push('An event needs a title.');
	if (title.length > TITLE_MAX) problems.push(`The title tops out at ${TITLE_MAX} characters.`);
	if (!validDay(date)) problems.push('Pick a real day for it.');
	if (time && !TIME_SHAPE.test(time)) problems.push('The time reads as hours:minutes.');
	if (time && !validTimezone(tz)) problems.push('A time needs its timezone.');
	if (place.length > PLACE_MAX) problems.push(`The place tops out at ${PLACE_MAX} characters.`);
	if (notes.length > NOTES_MAX) problems.push(`The notes top out at ${NOTES_MAX} characters.`);
	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		fields: {
			date,
			time: time || null,
			tz: time ? tz : null,
			title,
			place: place || null,
			notes: notes || null
		}
	};
}

/* ---------------------------------------------------------------- */
/* Time, honestly zoned                                              */

/**
 * The instant an event starts: its wall time in its own zone turned
 * into epoch milliseconds. Two Intl passes absorb the zone offset,
 * DST included - Workers ship full timezone data.
 */
export function eventEpoch(date: string, time: string, tz: string): number | null {
	try {
		const [y, mo, d] = date.split('-').map(Number);
		const [h, mi] = time.split(':').map(Number);
		const wall = Date.UTC(y, mo - 1, d, h, mi);
		let guess = wall;
		for (let pass = 0; pass < 2; pass++) {
			const parts = Object.fromEntries(
				new Intl.DateTimeFormat('en-US', {
					timeZone: tz,
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					hourCycle: 'h23'
				})
					.formatToParts(new Date(guess))
					.map((p) => [p.type, p.value])
			);
			const seen = Date.UTC(
				Number(parts.year),
				Number(parts.month) - 1,
				Number(parts.day),
				Number(parts.hour),
				Number(parts.minute)
			);
			guess += wall - seen;
		}
		return guess;
	} catch {
		return null;
	}
}

/** The event's own wall time with its zone named - what the admin
 * page shows, and the no-script fallback members see. */
export function eventTimeLabel(date: string, time: string, tz: string): string {
	const epoch = eventEpoch(date, time, tz);
	if (epoch == null) return time;
	return new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(new Date(epoch));
}

/* ---------------------------------------------------------------- */
/* Events                                                            */

export async function createEvent(db: Db, fields: EventFields): Promise<string> {
	const id = randomToken(16);
	await db.insert(table.events).values({ id, ...fields });
	return id;
}

export async function updateEvent(db: Db, id: string, fields: EventFields): Promise<boolean> {
	const found = await eventById(db, id);
	if (!found) return false;
	await db.update(table.events).set(fields).where(eq(table.events.id, id));
	return true;
}

export async function eventById(db: Db, id: string): Promise<EventRow | null> {
	return (await db.select().from(table.events).where(eq(table.events.id, id)))[0] ?? null;
}

/** Every event, future first - the admin list. */
export async function allEvents(db: Db): Promise<EventRow[]> {
	return db
		.select()
		.from(table.events)
		.orderBy(desc(table.events.date), desc(sql`rowid`));
}

/** One month's events, oldest first - the calendar card. Within a
 * day the all-day events lead (SQLite sorts their null time first),
 * then the timed ones in order. */
export async function monthEvents(db: Db, month: string): Promise<EventRow[]> {
	return db
		.select()
		.from(table.events)
		.where(like(table.events.date, `${month}-%`))
		.orderBy(asc(table.events.date), asc(table.events.time), asc(sql`rowid`));
}

/** The whole event leaves at once - bytes, gallery rows, the row, in
 * ONE atomic batch (hardening pass, 2026-08-26). Chunks go by
 * subquery so a full gallery cannot near D1's bound-parameter cap. */
export async function deleteEvent(db: Db, id: string): Promise<boolean> {
	const found = await eventById(db, id);
	if (!found) return false;
	await runBatch(db, [
		db
			.delete(table.eventImageChunks)
			.where(
				inArray(
					table.eventImageChunks.imageId,
					db
						.select({ id: table.eventImages.id })
						.from(table.eventImages)
						.where(eq(table.eventImages.eventId, id))
				)
			),
		db.delete(table.eventImages).where(eq(table.eventImages.eventId, id)),
		db.delete(table.events).where(eq(table.events.id, id))
	]);
	return true;
}

/* ---------------------------------------------------------------- */
/* The gallery                                                       */

export async function eventImageList(db: Db, eventId: string): Promise<EventImageRow[]> {
	return db
		.select()
		.from(table.eventImages)
		.where(eq(table.eventImages.eventId, eventId))
		.orderBy(asc(table.eventImages.position));
}

/** Image ids per event for a set of events, gallery order - what the
 * calendar card needs to draw thumbnails. */
export async function imageIdsByEvent(
	db: Db,
	eventIds: string[]
): Promise<Record<string, string[]>> {
	const out: Record<string, string[]> = {};
	if (!eventIds.length) return out;
	const rows = await db
		.select({ id: table.eventImages.id, eventId: table.eventImages.eventId })
		.from(table.eventImages)
		.where(inArray(table.eventImages.eventId, eventIds))
		.orderBy(asc(table.eventImages.position));
	for (const row of rows) (out[row.eventId] ??= []).push(row.id);
	return out;
}

/** The files a multipart form actually carried - an untouched file
 * input still submits one empty File. */
export const pickedFiles = (form: FormData, name: string): File[] =>
	form.getAll(name).filter((f): f is File => f instanceof File && f.size > 0 && f.name !== '');

export type AddImageResult =
	{ ok: true } | { ok: false; reason: 'not-an-image' | 'too-big' | 'gallery-full' | 'no-event' };

/** Stores one uploaded image: the meta row and every chunk in one
 * atomic D1 batch, so a dropped connection never leaves half an
 * image behind. */
export async function addEventImage(
	db: Db,
	d1: D1Database,
	eventId: string,
	file: File
): Promise<AddImageResult> {
	if (!(await eventById(db, eventId))) return { ok: false, reason: 'no-event' };
	if (!IMAGE_MIMES.includes(file.type)) return { ok: false, reason: 'not-an-image' };
	if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-big' };
	const existing = await eventImageList(db, eventId);
	if (existing.length >= MAX_IMAGES_PER_EVENT) return { ok: false, reason: 'gallery-full' };

	const id = randomToken(16);
	const position = (existing.at(-1)?.position ?? 0) + 1;
	const bytes = await file.arrayBuffer();
	const statements = [
		d1
			.prepare(
				'INSERT INTO event_images (id, event_id, position, mime, size) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(id, eventId, position, file.type, bytes.byteLength)
	];
	for (let seq = 0; seq * CHUNK_BYTES < bytes.byteLength; seq++) {
		const chunk = bytes.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
		statements.push(
			d1
				.prepare('INSERT INTO event_image_chunks (image_id, seq, bytes) VALUES (?, ?, ?)')
				.bind(id, seq, chunk)
		);
	}
	await d1.batch(statements);
	return { ok: true };
}

export async function deleteEventImage(db: Db, eventId: string, imageId: string): Promise<void> {
	await runBatch(db, [
		db.delete(table.eventImageChunks).where(eq(table.eventImageChunks.imageId, imageId)),
		db
			.delete(table.eventImages)
			.where(and(eq(table.eventImages.id, imageId), eq(table.eventImages.eventId, eventId)))
	]);
}

/** Whatever shape D1 hands blob bytes back in, out comes a
 * Uint8Array. */
const asBytes = (value: unknown): Uint8Array => {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (Array.isArray(value)) return Uint8Array.from(value as number[]);
	return new Uint8Array(0);
};

/** The image as a streamed HTTP body: chunks are fetched one at a
 * time as the client reads, so a gallery never holds whole images in
 * Worker memory. */
export async function imageResponse(db: Db, d1: D1Database, imageId: string): Promise<Response> {
	const meta = (
		await db.select().from(table.eventImages).where(eq(table.eventImages.id, imageId))
	)[0];
	if (!meta) return new Response('Not found', { status: 404 });
	const chunkCount = Math.ceil(meta.size / CHUNK_BYTES);
	let seq = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (seq >= chunkCount) {
				controller.close();
				return;
			}
			const row = await d1
				.prepare('SELECT bytes FROM event_image_chunks WHERE image_id = ? AND seq = ?')
				.bind(imageId, seq)
				.first<unknown>('bytes');
			seq += 1;
			const bytes = asBytes(row);
			if (!bytes.byteLength) {
				controller.error(new Error('missing image chunk'));
				return;
			}
			controller.enqueue(bytes);
		}
	});
	return new Response(body, {
		headers: { 'Content-Type': meta.mime, 'Content-Length': String(meta.size) }
	});
}

/* ---------------------------------------------------------------- */
/* The month grid                                                    */

export function monthOf(date: string): string {
	return date.slice(0, 7);
}

export function validMonth(month: string): boolean {
	if (!MONTH_SHAPE.test(month)) return false;
	const m = Number(month.slice(5));
	return m >= 1 && m <= 12;
}

const shiftMonth = (month: string, by: number): string => {
	const [y, m] = month.split('-').map(Number);
	const total = y * 12 + (m - 1) + by;
	const ny = Math.floor(total / 12);
	const nm = (total % 12) + 1;
	return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
};

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(y, m - 1, 1)));
}

export type CalendarCell = {
	day: number;
	iso: string;
	/** First event that day, for the anchor link down the page. */
	eventId: string | null;
	/** Which page of the events row holds it, so the day link can
	 * land on the right three. */
	eventPage: number | null;
	eventCount: number;
	today: boolean;
};

export type CalendarGrid = {
	month: string;
	label: string;
	prev: string;
	next: string;
	weekdays: string[];
	/** Six-at-most rows of seven; null pads the edges. */
	weeks: (CalendarCell | null)[][];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The grid, Sunday-start (the group dates in US Central), built as
 * plain data - the page just paints it. */
export function calendarGrid(month: string, todayIso: string, events: EventRow[]): CalendarGrid {
	const [y, m] = month.split('-').map(Number);
	const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
	const dayCount = new Date(Date.UTC(y, m, 0)).getUTCDate();

	const byDay = new Map<string, EventRow[]>();
	for (const event of events) {
		const list = byDay.get(event.date) ?? [];
		list.push(event);
		byDay.set(event.date, list);
	}
	const pageOf = new Map(events.map((e, i) => [e.id, Math.floor(i / EVENTS_PER_PAGE) + 1]));

	const cells: (CalendarCell | null)[] = Array.from({ length: firstWeekday }, () => null);
	for (let day = 1; day <= dayCount; day++) {
		const iso = `${month}-${String(day).padStart(2, '0')}`;
		const dayEvents = byDay.get(iso) ?? [];
		cells.push({
			day,
			iso,
			eventId: dayEvents[0]?.id ?? null,
			eventPage: dayEvents[0] ? (pageOf.get(dayEvents[0].id) ?? 1) : null,
			eventCount: dayEvents.length,
			today: iso === todayIso
		});
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: (CalendarCell | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

	return {
		month,
		label: monthLabel(month),
		prev: shiftMonth(month, -1),
		next: shiftMonth(month, 1),
		weekdays: WEEKDAYS,
		weeks
	};
}
