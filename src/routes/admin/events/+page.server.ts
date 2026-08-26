import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/admin';
import {
	addEventImage,
	allEvents,
	createEvent,
	eventTimeLabel,
	imageIdsByEvent,
	parseEventFields,
	pickedFiles
} from '$lib/server/events';
import { loadSettings, TIMEZONE_CHOICES } from '$lib/server/settings';
import { formatDate, today } from '$lib/server/stats';

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform!.env.DB);
	const events = await allEvents(db);
	const imageIds = await imageIdsByEvent(
		db,
		events.map((e) => e.id)
	);
	const settings = await loadSettings(db);
	return {
		events: events.map((e) => ({
			id: e.id,
			dateLabel: formatDate(e.date),
			// The admin page names the zone the time was entered in -
			// never anyone else's (owner ruling 2026-08-26).
			timeLabel: e.time && e.tz ? eventTimeLabel(e.date, e.time, e.tz) : 'all day',
			title: e.title,
			place: e.place ?? '',
			imageCount: (imageIds[e.id] ?? []).length
		})),
		timezoneChoices: TIMEZONE_CHOICES,
		siteTz: settings.timezone
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

export const actions: Actions = {
	add: async ({ request, locals, platform }) => {
		const actor = guard(locals);
		const env = platform!.env;
		const db = getDb(env.DB);
		const form = await request.formData();

		const parsed = parseEventFields(form);
		if (!parsed.ok) return fail(400, { problems: parsed.problems });
		const id = await createEvent(db, parsed.fields);

		// Images ride along on the add; one bad file never sinks the
		// event - it is skipped and said so on the next page.
		let skipped = 0;
		let stored = 0;
		for (const file of pickedFiles(form, 'images')) {
			const result = await addEventImage(db, env.DB, id, file);
			if (result.ok) stored += 1;
			else skipped += 1;
		}

		const settings = await loadSettings(db);
		await logAdmin(
			db,
			today(settings.timezone),
			actor.memberId,
			'added an event',
			null,
			`${parsed.fields.title} — ${parsed.fields.date}${stored ? `, ${stored} image${stored === 1 ? '' : 's'}` : ''}`
		);
		redirect(303, `/admin/events/${id}${skipped ? `?skipped=${skipped}` : ''}`);
	}
};
