import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb, type Field } from '$lib/server/db';
import {
	addField,
	allFields,
	FIELD_KINDS,
	fieldOptions,
	isCalculated,
	moveField,
	type FieldKind
} from '$lib/server/fields';
import { siteDay } from '$lib/server/settings';

function kindLabel(field: Field): string {
	if (field.type === 'choice') {
		return `${field.multiple ? 'pick several' : 'choices'} (${fieldOptions(field).length})`;
	}
	if (isCalculated(field)) return 'calculated';
	if (field.measure === 'mass') return 'weight';
	if (field.measure === 'length') return 'length';
	return 'number';
}

export const load: PageServerLoad = async ({ platform }) => ({
	fields: (await allFields(getDb(platform!.env.DB))).map((f) => ({
		id: f.id,
		name: f.name,
		kindLabel: kindLabel(f),
		active: f.status === 'active'
	}))
});

export const actions: Actions = {
	add: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '') as FieldKind;
		if (!FIELD_KINDS.includes(kind))
			return fail(400, { message: 'Pick what kind of field it is.' });
		const result = await addField(
			db,
			await siteDay(db),
			locals.member!.memberId,
			String(form.get('name') ?? ''),
			kind
		);
		if (!result.ok) return fail(400, { message: 'A field needs a name.' });
		redirect(303, `/admin/form/${result.id}`);
	},

	move: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const direction = form.get('direction') === 'up' ? 'up' : 'down';
		await moveField(
			db,
			await siteDay(db),
			locals.member!.memberId,
			String(form.get('id') ?? ''),
			direction
		);
		redirect(303, '/admin/form');
	}
};
