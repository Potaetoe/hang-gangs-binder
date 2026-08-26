import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { identityOf, type Secrets } from '$lib/server/auth';
import {
	carryForward,
	computeBmi,
	createEntry,
	formatDate,
	formatValue,
	formFieldViews,
	latestValues,
	formUnits,
	loadFields,
	memberHistory,
	memberTrends,
	memberUnits,
	parseEntryForm,
	sparklinePoints,
	today
} from '$lib/server/stats';
import {
	calendarGrid,
	eventEpoch,
	EVENTS_PER_PAGE,
	eventTimeLabel,
	imageIdsByEvent,
	monthEvents,
	monthOf,
	validMonth
} from '$lib/server/events';
import { loadSettings } from '$lib/server/settings';
import type {
	CalendarView,
	EntryTableView,
	EventsPagerView,
	EventView,
	TrendView
} from '$lib/views';

// Entries page by fifty (owner ruling 2026-08-26) - the card caps its
// own height and scrolls, so a page can afford to be deep.
const PAGE_SIZE = 50;

/** Everything a submitted form's fields said, echoed back on failure
 * so a typo never costs the rest of what was typed. Checkboxes repeat
 * their name once per tick, so every key collects a list. */
const rawEcho = (form: FormData): Record<string, string[]> => {
	const raw: Record<string, string[]> = {};
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('f_') || typeof value !== 'string') continue;
		(raw[key] ??= []).push(value);
	}
	return raw;
};

export const load: PageServerLoad = async ({ locals, platform, url, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const env = platform!.env;
	const db = getDb(env.DB);
	const memberId = locals.member.memberId;
	const units = memberUnits(cookies, url);

	const identity = await identityOf(db, env as unknown as Secrets, memberId);
	const fields = await loadFields(db);
	const latest = await latestValues(db, memberId);
	const todayIso = today((await loadSettings(db)).timezone);

	// The calendar card's month: today's unless the member flipped it.
	const calParam = url.searchParams.get('cal') ?? '';
	const month = validMonth(calParam) ? calParam : monthOf(todayIso);
	const eventRows = await monthEvents(db, month);
	const grid = calendarGrid(month, todayIso, eventRows);
	const calendar: CalendarView = {
		label: grid.label,
		prev: grid.prev,
		next: grid.next,
		weekdays: grid.weekdays,
		weeks: grid.weeks
	};

	// The events row shows three at a time (owner ruling 2026-08-26);
	// `ev` picks which three, and the day links carry it.
	const eventPages = Math.max(1, Math.ceil(eventRows.length / EVENTS_PER_PAGE));
	const eventPage = Math.min(Math.max(1, Number(url.searchParams.get('ev')) || 1), eventPages);
	const pageRows = eventRows.slice((eventPage - 1) * EVENTS_PER_PAGE, eventPage * EVENTS_PER_PAGE);
	const eventsPager: EventsPagerView = {
		page: eventPage,
		pages: eventPages,
		from: eventRows.length ? (eventPage - 1) * EVENTS_PER_PAGE + 1 : 0,
		to: (eventPage - 1) * EVENTS_PER_PAGE + pageRows.length,
		total: eventRows.length
	};
	const imageIds = await imageIdsByEvent(
		db,
		pageRows.map((e) => e.id)
	);
	const events: EventView[] = pageRows.map((e) => ({
		id: e.id,
		date: e.date,
		dateLabel: formatDate(e.date),
		timeLabel: e.time && e.tz ? eventTimeLabel(e.date, e.time, e.tz) : null,
		epoch: e.time && e.tz ? eventEpoch(e.date, e.time, e.tz) : null,
		title: e.title,
		place: e.place,
		notes: e.notes,
		imageIds: imageIds[e.id] ?? []
	}));

	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const { entries, hasOlder } = await memberHistory(db, memberId, page, PAGE_SIZE);
	// The entries as a real table (owner ruling 2026-08-26): one column
	// per active field, so a row reads like the form that made it.
	const entryTable: EntryTableView = {
		columns: fields.map((f) => f.name),
		rows: entries.map(({ entry, values }) => ({
			id: entry.id,
			dateLabel: formatDate(entry.date),
			cells: fields.map((field) => {
				const value = values.find((v) => v.fieldId === field.id);
				return value ? formatValue(field, value, units) : '';
			})
		}))
	};

	const trends: TrendView[] = (await memberTrends(db, fields, memberId, units)).map((t) => ({
		name: t.field.name,
		poly: sparklinePoints(t.points),
		latest: t.latest
	}));

	// The door-knock banner: admins hear about waiting registrations
	// the moment they land (owner, 2026-08-24).
	const pendingCount = locals.member.isAdmin
		? (
				await db
					.select({ id: table.members.id })
					.from(table.members)
					.where(eq(table.members.status, 'pending'))
			).length
		: 0;

	return {
		name: identity.displayName || identity.handle || identity.username || 'member',
		isAdmin: locals.member.isAdmin,
		pendingCount,
		units,
		formFields: formFieldViews(fields, latest, units),
		trends,
		calendar,
		events,
		eventsPager,
		month,
		entryTable,
		page,
		hasOlder
	};
};

export const actions: Actions = {
	entry: async ({ request, locals, platform, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const env = platform!.env;
		const db = getDb(env.DB);
		const form = await request.formData();
		const units = formUnits(form, cookies);

		const fields = await loadFields(db);
		const { values, problems } = parseEntryForm(fields, form, units);
		if (problems.length) return fail(400, { problems, raw: rawEcho(form) });

		// A blank field keeps its last value - nobody re-enters what the
		// binder already knows (owner ruling 2026-08-24).
		carryForward(fields, values, await latestValues(db, locals.member.memberId));
		if (!Object.keys(values).length) {
			return fail(400, {
				problems: ['Nothing to save yet - fill in at least one field.'],
				raw: rawEcho(form)
			});
		}

		computeBmi(fields, values);
		await createEntry(db, locals.member.memberId, today((await loadSettings(db)).timezone), values);
		// The confirmation shows in the units just typed in; the script
		// strips ?u=, so the next load is the default again.
		redirect(303, `/home?u=${units}`);
	}
};
