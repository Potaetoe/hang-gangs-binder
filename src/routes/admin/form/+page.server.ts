import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { addField, allFields, moveField, type FieldKind } from '$lib/server/form';
import { fieldOptions } from '$lib/server/stats';
import { loadSettings } from '$lib/server/settings';
import { today } from '$lib/server/stats';

const KINDS: FieldKind[] = ['choice', 'mass', 'length', 'plain'];

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform!.env.DB);
	const fields = await allFields(db);
	return {
		fields: fields.map((f) => ({
			id: f.id,
			name: f.name,
			kindLabel:
				f.type === 'choice'
					? `choices (${fieldOptions(f).length})`
					: f.computed === 'bmi'
						? 'computed'
						: f.measure === 'mass'
							? 'weight'
							: f.measure === 'length'
								? 'length'
								: 'number',
			active: f.status === 'active'
		}))
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

export const actions: Actions = {
	add: async ({ request, locals, platform }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const kind = String(form.get('kind') ?? '');
		if (!KINDS.includes(kind as FieldKind))
			return fail(400, { message: 'Pick what kind of field it is.' });
		const settings = await loadSettings(db);
		const result = await addField(
			db,
			today(settings.timezone),
			actor.memberId,
			name,
			kind as FieldKind
		);
		if (!result.ok) return fail(400, { message: 'A field needs a name.' });
		redirect(303, `/admin/form/${result.id}`);
	},

	move: async ({ request, locals, platform }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const direction = form.get('direction') === 'up' ? 'up' : 'down';
		const settings = await loadSettings(db);
		await moveField(db, today(settings.timezone), actor.memberId, id, direction);
		redirect(303, '/admin/form');
	}
};
