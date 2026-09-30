import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/changelog';
import {
	addEventImages,
	allEvents,
	createEvent,
	eventTimeLabel,
	imageIdsByEvent,
	parseEventFields,
	pickedFiles,
	rsvpCounts
} from '$lib/server/events';
import { loadSettings, siteDay, TIMEZONE_CHOICES } from '$lib/server/settings';
import { formatDay } from '$lib/server/days';

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform!.env.DB);
	const events = await allEvents(db);
	const ids = events.map((e) => e.id);
	const [imageIds, counts, settings] = await Promise.all([
		imageIdsByEvent(db, ids),
		rsvpCounts(db, ids),
		loadSettings(db)
	]);
	return {
		events: events.map((e) => ({
			id: e.id,
			dateLabel: formatDay(e.date),
			// Admins see the time in the zone it was entered in.
			timeLabel: e.time && e.tz ? eventTimeLabel(e.date, e.time, e.tz) : 'all day',
			title: e.title,
			place: e.place ?? '',
			imageCount: imageIds[e.id]?.length ?? 0,
			rsvpCount: counts[e.id] ?? 0
		})),
		timezoneChoices: TIMEZONE_CHOICES,
		siteTz: settings.timezone
	};
};

export const actions: Actions = {
	add: async ({ request, locals, platform }) => {
		const env = platform!.env;
		const db = getDb(env.DB);
		const form = await request.formData();
		const parsed = parseEventFields(form);
		if (!parsed.ok) return fail(400, { problems: parsed.problems });
		const id = await createEvent(db, parsed.fields);
		// A bad image never sinks the event; the next page says it was skipped.
		const { stored, skipped } = await addEventImages(db, env.DB, id, pickedFiles(form, 'images'));
		const images = stored ? `, ${stored} image${stored === 1 ? '' : 's'}` : '';
		await logAdmin(
			db,
			await siteDay(db),
			locals.member!.memberId,
			'added an event',
			null,
			`${parsed.fields.title} — ${parsed.fields.date}${images}`
		);
		redirect(303, `/admin/events/${id}${skipped ? `?skipped=${skipped}` : ''}`);
	}
};
