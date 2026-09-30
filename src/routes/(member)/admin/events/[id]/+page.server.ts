import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/changelog';
import { allIdentities, nameOf } from '$lib/server/identity';
import {
	addEventImages,
	deleteEvent,
	deleteEventImage,
	eventById,
	eventImageList,
	MAX_IMAGE_BYTES,
	MAX_IMAGES_PER_EVENT,
	parseEventFields,
	pickedFiles,
	rsvpLastDay,
	rsvpMemberIds,
	rsvpOpen,
	updateEvent
} from '$lib/server/events';
import { loadSettings, siteDay, TIMEZONE_CHOICES } from '$lib/server/settings';
import { dayIn, formatDay } from '$lib/server/days';

const SKIPPED_RULE = `each must be an image, ${MAX_IMAGE_BYTES / 1024 / 1024} MB at most, ${MAX_IMAGES_PER_EVENT} to an event`;

export const load: PageServerLoad = async ({ params, platform, url }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const event = await eventById(db, params.id);
	if (!event) error(404, 'No such event');
	const [images, settings, rsvpIds] = await Promise.all([
		eventImageList(db, event.id),
		loadSettings(db),
		rsvpMemberIds(db, event.id)
	]);
	// Names are for admins only; members see just the count.
	const identities = rsvpIds.length ? await allIdentities(db, env) : new Map();
	const interested = rsvpIds
		.map((id) => ({ id, name: nameOf(identities.get(id)) || '(no name on file)' }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		event: {
			id: event.id,
			date: event.date,
			time: event.time ?? '',
			tz: event.tz ?? '',
			title: event.title,
			place: event.place ?? '',
			notes: event.notes ?? '',
			rsvpUntil: event.rsvpUntil ?? ''
		},
		interested,
		rsvpOpen: rsvpOpen(event, dayIn(settings.timezone)),
		rsvpLastDayLabel: formatDay(rsvpLastDay(event)),
		imageIds: images.map((i) => i.id),
		skipped: Math.max(0, Number(url.searchParams.get('skipped')) || 0),
		skippedRule: SKIPPED_RULE,
		timezoneChoices: TIMEZONE_CHOICES,
		siteTz: settings.timezone
	};
};

export const actions: Actions = {
	save: async ({ params, request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		if (!(await eventById(db, params.id))) error(404, 'No such event');
		const parsed = parseEventFields(await request.formData());
		if (!parsed.ok) return fail(400, { problems: parsed.problems });
		await updateEvent(db, params.id, parsed.fields);
		await logAdmin(
			db,
			await siteDay(db),
			locals.member!.memberId,
			'changed an event',
			null,
			`${parsed.fields.title} — ${parsed.fields.date}`
		);
		return { done: 'Saved.' };
	},

	addimages: async ({ params, request, locals, platform }) => {
		const env = platform!.env;
		const db = getDb(env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		const files = pickedFiles(await request.formData(), 'images');
		if (!files.length) return fail(400, { problems: ['Pick an image first.'] });
		const { stored, skipped } = await addEventImages(db, env.DB, event.id, files);
		if (stored) {
			await logAdmin(
				db,
				await siteDay(db),
				locals.member!.memberId,
				'changed an event',
				null,
				`${event.title} — added ${stored} image${stored === 1 ? '' : 's'}`
			);
		}
		if (skipped) {
			const which = skipped === 1 ? 'One image' : `${skipped} images`;
			return fail(400, { problems: [`${which} did not make it — ${SKIPPED_RULE}.`], stored });
		}
		return { done: `${stored === 1 ? 'Image' : `${stored} images`} added.` };
	},

	delimage: async ({ params, request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		const imageId = String((await request.formData()).get('image') ?? '');
		await deleteEventImage(db, event.id, imageId);
		await logAdmin(
			db,
			await siteDay(db),
			locals.member!.memberId,
			'changed an event',
			null,
			`${event.title} — removed an image`
		);
		return { done: 'Image removed.' };
	},

	delete: async ({ params, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const event = await eventById(db, params.id);
		if (!event) error(404, 'No such event');
		await deleteEvent(db, event.id);
		await logAdmin(
			db,
			await siteDay(db),
			locals.member!.memberId,
			'deleted an event',
			null,
			`${event.title} — ${event.date}`
		);
		redirect(303, '/admin/events');
	}
};
