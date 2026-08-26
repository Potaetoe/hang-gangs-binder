import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/admin';
import {
	addEventImage,
	deleteEvent,
	deleteEventImage,
	eventById,
	eventImageList,
	parseEventFields,
	pickedFiles,
	updateEvent
} from '$lib/server/events';
import { loadSettings, TIMEZONE_CHOICES } from '$lib/server/settings';
import { today } from '$lib/server/stats';

export const load: PageServerLoad = async ({ params, platform, url }) => {
	const db = getDb(platform!.env.DB);
	const event = await eventById(db, params.id);
	if (!event) error(404, 'No such event');
	const images = await eventImageList(db, event.id);
	const skipped = Math.max(0, Number(url.searchParams.get('skipped')) || 0);
	const settings = await loadSettings(db);
	return {
		event: {
			id: event.id,
			date: event.date,
			time: event.time ?? '',
			tz: event.tz ?? '',
			title: event.title,
			place: event.place ?? '',
			notes: event.notes ?? ''
		},
		images: images.map((i) => ({ id: i.id })),
		skipped,
		timezoneChoices: TIMEZONE_CHOICES,
		siteTz: settings.timezone
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

const logDate = async (db: ReturnType<typeof getDb>) => today((await loadSettings(db)).timezone);

export const actions: Actions = {
	save: async ({ params, request, locals, platform }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const parsed = parseEventFields(form);
		if (!parsed.ok) return fail(400, { problems: parsed.problems });
		if (!(await updateEvent(db, params.id, parsed.fields))) error(404, 'No such event');
		await logAdmin(
			db,
			await logDate(db),
			actor.memberId,
			'changed an event',
			null,
			`${parsed.fields.title} — ${parsed.fields.date}`
		);
		return { done: 'Saved.' };
	},

	addimages: async ({ params, request, locals, platform }) => {
		const actor = guard(locals);
		const env = platform!.env;
		const db = getDb(env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		const form = await request.formData();
		const files = pickedFiles(form, 'images');
		if (!files.length) return fail(400, { problems: ['Pick an image first.'] });
		let stored = 0;
		let skipped = 0;
		for (const file of files) {
			const result = await addEventImage(db, env.DB, params.id, file);
			if (result.ok) stored += 1;
			else skipped += 1;
		}
		if (stored) {
			await logAdmin(
				db,
				await logDate(db),
				actor.memberId,
				'changed an event',
				null,
				`${event.title} — added ${stored} image${stored === 1 ? '' : 's'}`
			);
		}
		if (skipped) {
			return fail(400, {
				problems: [
					`${skipped === 1 ? 'One image' : `${skipped} images`} did not make it — each must be an image, 2 MB at most, 8 to an event.`
				],
				stored
			});
		}
		return { done: `${stored === 1 ? 'Image' : `${stored} images`} added.` };
	},

	delimage: async ({ params, request, locals, platform }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		const form = await request.formData();
		const imageId = String(form.get('image') ?? '');
		await deleteEventImage(db, params.id, imageId);
		await logAdmin(
			db,
			await logDate(db),
			actor.memberId,
			'changed an event',
			null,
			`${event.title} — removed an image`
		);
		return { done: 'Image removed.' };
	},

	delete: async ({ params, locals, platform }) => {
		const actor = guard(locals);
		const env = platform!.env;
		const db = getDb(env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		await deleteEvent(db, env.DB, params.id);
		await logAdmin(
			db,
			await logDate(db),
			actor.memberId,
			'deleted an event',
			null,
			`${event.title} — ${event.date}`
		);
		redirect(303, '/admin/events');
	}
};
