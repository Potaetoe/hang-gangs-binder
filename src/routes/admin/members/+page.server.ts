import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { approveMember, denyMember, memberRoster } from '$lib/server/admin';
import { loadSettings } from '$lib/server/settings';
import { today } from '$lib/server/stats';
import type { Secrets } from '$lib/server/auth';

export const load: PageServerLoad = async ({ platform }) => {
	const env = platform!.env;
	const roster = await memberRoster(getDb(env.DB), env as unknown as Secrets);
	return {
		// Waiting registrations ride a card above the table (owner,
		// 2026-08-24); the table holds the real members.
		pending: roster.filter((m) => m.status === 'pending'),
		roster: roster.filter((m) => m.status !== 'pending')
	};
};

export const actions: Actions = {
	approve: async ({ request, locals, platform }) => {
		if (!locals.member?.isAdmin) redirect(303, '/home');
		const db = getDb(platform!.env.DB);
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No member named.' });
		const settings = await loadSettings(db);
		await approveMember(db, today(settings.timezone), locals.member.memberId, id);
		redirect(303, '/admin/members');
	},

	deny: async ({ request, locals, platform }) => {
		if (!locals.member?.isAdmin) redirect(303, '/home');
		const db = getDb(platform!.env.DB);
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No member named.' });
		const settings = await loadSettings(db);
		const ok = await denyMember(db, today(settings.timezone), locals.member.memberId, id);
		if (!ok) return fail(400, { message: 'Only a pending registration can be denied.' });
		redirect(303, '/admin/members');
	}
};
