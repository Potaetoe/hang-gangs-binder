import { asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { Db, EventRow } from '../db';
import * as table from '../db/schema';
import { runBatch } from '../db';
import { randomToken } from '../crypto';
import { validDay, validTimezone } from '../days';

export const TITLE_MAX = 80;
export const PLACE_MAX = 120;
export const NOTES_MAX = 2000;

const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type EventFields = {
	date: string;
	time: string | null;
	tz: string | null;
	title: string;
	place: string | null;
	notes: string | null;
	rsvpUntil: string | null;
};

/** Reads the add/edit form, every fault at once. No time means all day;
 * a time must bring its zone, because nothing is assumed. */
export function parseEventFields(
	form: FormData
): { ok: true; fields: EventFields } | { ok: false; problems: string[] } {
	const text = (key: string) => String(form.get(key) ?? '').trim();
	const [title, date, time, tz, place, notes, rsvpUntil] = [
		'title',
		'date',
		'time',
		'tz',
		'place',
		'notes',
		'rsvp_until'
	].map(text);
	const problems: string[] = [];
	if (!title) problems.push('An event needs a title.');
	if (title.length > TITLE_MAX) problems.push(`The title tops out at ${TITLE_MAX} characters.`);
	if (!validDay(date)) problems.push('Pick a real day for it.');
	if (time && !TIME_SHAPE.test(time)) problems.push('The time reads as hours:minutes.');
	if (time && !validTimezone(tz)) problems.push('A time needs its timezone.');
	if (place.length > PLACE_MAX) problems.push(`The place tops out at ${PLACE_MAX} characters.`);
	if (notes.length > NOTES_MAX) problems.push(`The notes top out at ${NOTES_MAX} characters.`);
	if (rsvpUntil && !validDay(rsvpUntil)) problems.push('Pick a real day for the RSVP to close.');
	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		fields: {
			date,
			time: time || null,
			tz: time ? tz : null,
			title,
			place: place || null,
			notes: notes || null,
			rsvpUntil: rsvpUntil || null
		}
	};
}

export async function eventById(db: Db, id: string): Promise<EventRow | null> {
	const [event] = await db.select().from(table.events).where(eq(table.events.id, id));
	return event ?? null;
}

export async function createEvent(db: Db, fields: EventFields): Promise<string> {
	const id = randomToken(16);
	await db.insert(table.events).values({ id, ...fields });
	return id;
}

export async function updateEvent(db: Db, id: string, fields: EventFields) {
	await db.update(table.events).set(fields).where(eq(table.events.id, id));
}

/** Newest first, for the admin list. */
export async function allEvents(db: Db): Promise<EventRow[]> {
	return db
		.select()
		.from(table.events)
		.orderBy(desc(table.events.date), desc(sql`rowid`));
}

/** One month, oldest first. SQLite sorts a null time first, so all-day
 * events lead their day. */
export async function monthEvents(db: Db, month: string): Promise<EventRow[]> {
	return db
		.select()
		.from(table.events)
		.where(like(table.events.date, `${month}-%`))
		.orderBy(asc(table.events.date), asc(table.events.time), asc(sql`rowid`));
}

/** Bytes, gallery, RSVPs and the row leave in one batch. Chunks go by
 * subquery so a full gallery cannot near D1's parameter cap. */
export async function deleteEvent(db: Db, id: string) {
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
		db.delete(table.eventRsvps).where(eq(table.eventRsvps.eventId, id)),
		db.delete(table.events).where(eq(table.events.id, id))
	]);
}
