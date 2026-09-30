import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { approveMember, denyMember, memberRoster } from '$lib/server/admin';
import { siteDay } from '$lib/server/settings';

export const load: PageServerLoad = async ({ platform }) => {
	const env = platform!.env;
	const roster = await memberRoster(getDb(env.DB), env);
	return {
		pending: roster.filter((m) => m.status === 'pending'),
		roster: roster.filter((m) => m.status !== 'pending')
	};
};

export const actions: Actions = {
	approve: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No member named.' });
		await approveMember(db, await siteDay(db), locals.member!.memberId, id);
		redirect(303, '/admin/members');
	},

	deny: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No member named.' });
		if (!(await denyMember(db, await siteDay(db), locals.member!.memberId, id))) {
			return fail(400, { message: 'Only a pending registration can be denied.' });
		}
		redirect(303, '/admin/members');
	}
};
