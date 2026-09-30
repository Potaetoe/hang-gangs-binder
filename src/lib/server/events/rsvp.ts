/**
 * "I'm interested" toggles. Members see a count and their own answer,
 * never who else; names are for the admin event page.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db, EventRow } from '../db';
import * as table from '../db/schema';

type RsvpDays = Pick<EventRow, 'date' | 'rsvpUntil'>;

/** The admin's chosen last day, else the event's own day. */
export const rsvpLastDay = (event: RsvpDays): string => event.rsvpUntil ?? event.date;

/** Open through the last day inclusive, on the site's calendar. ISO days
 * compare correctly as strings. */
export const rsvpOpen = (event: RsvpDays, today: string): boolean => today <= rsvpLastDay(event);

/** An event nobody picked is absent; read it as 0. */
export async function rsvpCounts(db: Db, eventIds: string[]): Promise<Record<string, number>> {
	if (!eventIds.length) return {};
	const rows = await db
		.select({ eventId: table.eventRsvps.eventId, n: sql<number>`count(*)` })
		.from(table.eventRsvps)
		.where(inArray(table.eventRsvps.eventId, eventIds))
		.groupBy(table.eventRsvps.eventId);
	return Object.fromEntries(rows.map((r) => [r.eventId, r.n]));
}

/** Which of these events the member is interested in. */
export async function rsvpsOf(db: Db, memberId: string, eventIds: string[]): Promise<Set<string>> {
	if (!eventIds.length) return new Set();
	const rows = await db
		.select({ eventId: table.eventRsvps.eventId })
		.from(table.eventRsvps)
		.where(
			and(eq(table.eventRsvps.memberId, memberId), inArray(table.eventRsvps.eventId, eventIds))
		);
	return new Set(rows.map((r) => r.eventId));
}

/** Idempotent both ways, so a double tap is harmless. */
export async function setRsvp(db: Db, eventId: string, memberId: string, on: boolean) {
	if (on) {
		await db.insert(table.eventRsvps).values({ eventId, memberId }).onConflictDoNothing();
	} else {
		await db
			.delete(table.eventRsvps)
			.where(and(eq(table.eventRsvps.eventId, eventId), eq(table.eventRsvps.memberId, memberId)));
	}
}

export async function rsvpMemberIds(db: Db, eventId: string): Promise<string[]> {
	const rows = await db
		.select({ memberId: table.eventRsvps.memberId })
		.from(table.eventRsvps)
		.where(eq(table.eventRsvps.eventId, eventId));
	return rows.map((r) => r.memberId);
}
