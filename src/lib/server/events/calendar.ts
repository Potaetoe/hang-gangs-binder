/**
 * The home page's calendar card: a month grid with event days marked,
 * and that month's events three at a time with a pager.
 */

import type { Db, EventRow } from '../db';
import type { CalendarView, EventsPagerView, EventView } from '$lib/views';
import { formatDay } from '../days';
import { monthEvents } from './events';
import { imageIdsByEvent } from './images';
import { rsvpCounts, rsvpOpen, rsvpsOf } from './rsvp';
import { eventEpoch, eventTimeLabel } from './time';

export const EVENTS_PER_PAGE = 3;

const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthOf = (date: string): string => date.slice(0, 7);

export const validMonth = (month: string): boolean => MONTH_SHAPE.test(month);

function shiftMonth(month: string, by: number): string {
	const [y, m] = month.split('-').map(Number);
	const total = y * 12 + (m - 1) + by;
	return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Sunday-start, because the group lives in the US. A marked day links
 * to the pager page that holds its first event. */
export function calendarGrid(month: string, today: string, events: EventRow[]): CalendarView {
	const [y, m] = month.split('-').map(Number);
	const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
	const dayCount = new Date(Date.UTC(y, m, 0)).getUTCDate();

	const cells: CalendarView['weeks'][number] = Array.from({ length: firstWeekday }, () => null);
	for (let day = 1; day <= dayCount; day++) {
		const iso = `${month}-${String(day).padStart(2, '0')}`;
		const index = events.findIndex((e) => e.date === iso);
		cells.push({
			day,
			eventId: events[index]?.id ?? null,
			eventPage: index < 0 ? null : Math.floor(index / EVENTS_PER_PAGE) + 1,
			eventCount: events.filter((e) => e.date === iso).length,
			today: iso === today
		});
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: CalendarView['weeks'] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return {
		label: monthLabel(month),
		prev: shiftMonth(month, -1),
		next: shiftMonth(month, 1),
		weekdays: WEEKDAYS,
		weeks
	};
}

/** Everything the card draws for one member. */
export async function calendarCard(
	db: Db,
	memberId: string,
	month: string,
	requestedPage: number,
	today: string
): Promise<{ calendar: CalendarView; events: EventView[]; eventsPager: EventsPagerView }> {
	const rows = await monthEvents(db, month);
	const pages = Math.max(1, Math.ceil(rows.length / EVENTS_PER_PAGE));
	const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
	const first = (page - 1) * EVENTS_PER_PAGE;
	const shown = rows.slice(first, first + EVENTS_PER_PAGE);
	const ids = shown.map((e) => e.id);
	const [imageIds, counts, mine] = await Promise.all([
		imageIdsByEvent(db, ids),
		rsvpCounts(db, ids),
		rsvpsOf(db, memberId, ids)
	]);
	return {
		calendar: calendarGrid(month, today, rows),
		events: shown.map((e) => {
			const timed = e.time && e.tz ? { time: e.time, tz: e.tz } : null;
			return {
				id: e.id,
				date: e.date,
				dateLabel: formatDay(e.date),
				timeLabel: timed && eventTimeLabel(e.date, timed.time, timed.tz),
				epoch: timed && eventEpoch(e.date, timed.time, timed.tz),
				title: e.title,
				place: e.place,
				notes: e.notes,
				imageIds: imageIds[e.id] ?? [],
				rsvpCount: counts[e.id] ?? 0,
				rsvpMine: mine.has(e.id),
				rsvpOpen: rsvpOpen(e, today),
				rsvpUntilLabel: e.rsvpUntil ? formatDay(e.rsvpUntil) : null
			};
		}),
		eventsPager: {
			page,
			pages,
			from: rows.length ? first + 1 : 0,
			to: first + shown.length,
			total: rows.length
		}
	};
}
