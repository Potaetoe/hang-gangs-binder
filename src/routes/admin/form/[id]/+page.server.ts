import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	addOption,
	deleteField,
	ESSENTIAL,
	removeOption,
	renameField,
	renameOption,
	retireField,
	reviveField
} from '$lib/server/form';
import { fieldOptions, today } from '$lib/server/stats';
import { loadSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ platform, params }) => {
	const db = getDb(platform!.env.DB);
	const field = (await db.select().from(table.fields).where(eq(table.fields.id, params.id)))[0];
	if (!field) error(404, 'Not found');
	const used = (
		await db
			.select({ fieldId: table.entryValues.fieldId })
			.from(table.entryValues)
			.where(eq(table.entryValues.fieldId, params.id))
			.limit(1)
	)[0];
	return {
		field: {
			id: field.id,
			name: field.name,
			isChoice: field.type === 'choice',
			computed: Boolean(field.computed),
			active: field.status === 'active',
			essential: ESSENTIAL.has(field.id),
			options: fieldOptions(field),
			used: Boolean(used)
		}
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

type Ctx = { request: Request; locals: App.Locals; platform: Readonly<App.Platform> | undefined };

async function run(
	event: Ctx,
	act: (
		db: ReturnType<typeof getDb>,
		date: string,
		actorId: string,
		form: FormData
	) => Promise<{ ok: true } | { ok: false; reason: string }>,
	backTo: string | null = null
) {
	const actor = guard(event.locals);
	const db = getDb(event.platform!.env.DB);
	const form = await event.request.formData();
	const settings = await loadSettings(db);
	const result = await act(db, today(settings.timezone), actor.memberId, form);
	if (!result.ok) return fail(400, { message: result.reason });
	if (backTo) redirect(303, backTo);
	return { done: true };
}

export const actions: Actions = {
	rename: async (event) =>
		run(event, (db, date, actor, form) =>
			renameField(db, date, actor, event.params.id, String(form.get('name') ?? ''))
		),

	retire: async (event) =>
		run(event, (db, date, actor) => retireField(db, date, actor, event.params.id)),

	revive: async (event) =>
		run(event, (db, date, actor) => reviveField(db, date, actor, event.params.id)),

	delete: async (event) =>
		run(event, (db, date, actor) => deleteField(db, date, actor, event.params.id), '/admin/form'),

	addoption: async (event) =>
		run(event, (db, date, actor, form) =>
			addOption(db, date, actor, event.params.id, String(form.get('option') ?? ''))
		),

	renameoption: async (event) =>
		run(event, (db, date, actor, form) =>
			renameOption(
				db,
				date,
				actor,
				event.params.id,
				String(form.get('from') ?? ''),
				String(form.get('to') ?? '')
			)
		),

	removeoption: async (event) =>
		run(event, (db, date, actor, form) =>
			removeOption(db, date, actor, event.params.id, String(form.get('option') ?? ''))
		)
};
