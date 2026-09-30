import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	approveMember,
	correctionsOf,
	denyMember,
	purgeMember,
	setAdminRole,
	setTempPassphrase
} from '$lib/server/admin';
import { logAdmin } from '$lib/server/changelog';
import { PASSWORD_MAX, PASSWORD_MIN } from '$lib/server/auth';
import { identityOf, nameOf } from '$lib/server/identity';
import { hasSocials, setSocials } from '$lib/server/socials';
import { siteDay } from '$lib/server/settings';
import { loadFields } from '$lib/server/fields';
import { entryTable, memberHistory } from '$lib/server/entries';
import { memberUnits } from '$lib/server/units';

export const load: PageServerLoad = async ({ platform, params, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const [member] = await db.select().from(table.members).where(eq(table.members.id, params.id));
	if (!member) error(404, 'Not found');
	const identity = await identityOf(db, env, params.id);
	const doors = (
		await db
			.select({ kind: table.logins.kind })
			.from(table.logins)
			.where(eq(table.logins.memberId, params.id))
	).map((l) => l.kind);
	const { entries } = await memberHistory(db, params.id, 1, 500);
	return {
		member: {
			id: member.id,
			status: member.status,
			isAdmin: member.isAdmin,
			name: nameOf(identity) || '(no name on file)',
			username: identity.username ?? null,
			handle: identity.handle ?? null,
			doors: doors.sort().join(' + ')
		},
		hasPasswordDoor: doors.includes('password'),
		hasSocials: await hasSocials(db, params.id),
		passwordMin: PASSWORD_MIN,
		entries: entryTable(await loadFields(db), entries, memberUnits(cookies)),
		corrections: await correctionsOf(db, params.id)
	};
};

export const actions: Actions = {
	approve: async ({ locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		await approveMember(db, await siteDay(db), locals.member!.memberId, params.id);
		redirect(303, `/admin/members/${params.id}`);
	},

	deny: async ({ locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		if (!(await denyMember(db, await siteDay(db), locals.member!.memberId, params.id))) {
			return fail(400, { message: 'Only a pending registration can be denied.' });
		}
		redirect(303, '/admin/members');
	},

	role: async ({ request, locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		const makeAdmin = (await request.formData()).get('make') === 'admin';
		const result = await setAdminRole(
			db,
			await siteDay(db),
			locals.member!.memberId,
			params.id,
			makeAdmin
		);
		if (!result.ok) {
			return fail(400, {
				message:
					result.reason === 'self'
						? 'You cannot remove your own admin role.'
						: 'The site refuses to lose its last admin.'
			});
		}
		redirect(303, `/admin/members/${params.id}`);
	},

	passphrase: async ({ request, locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		const passphrase = String((await request.formData()).get('passphrase') ?? '');
		const result = await setTempPassphrase(
			db,
			await siteDay(db),
			locals.member!.memberId,
			params.id,
			passphrase
		);
		if (!result.ok) {
			return fail(400, {
				message:
					result.reason === 'no-password-door'
						? 'This member has no password sign-in to reset.'
						: `A passphrase needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`
			});
		}
		return {
			done: 'Passphrase set. Hand it over out of band; their next sign-in demands a new password.'
		};
	},

	/** The moderation lever: their links leave the Socials page. */
	clearsocials: async ({ locals, platform, params }) => {
		const env = platform!.env;
		const db = getDb(env.DB);
		await setSocials(db, env, params.id, null);
		await logAdmin(
			db,
			await siteDay(db),
			locals.member!.memberId,
			'cleared the socials',
			params.id
		);
		redirect(303, `/admin/members/${params.id}`);
	},

	purge: async ({ locals, platform, params }) => {
		const db = getDb(platform!.env.DB);
		await purgeMember(db, await siteDay(db), locals.member!.memberId, params.id);
		redirect(303, '/admin/members');
	}
};
