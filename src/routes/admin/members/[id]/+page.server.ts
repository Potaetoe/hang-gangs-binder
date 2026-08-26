import { error, fail, redirect } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	approveMember,
	denyMember,
	purgeMember,
	setAdminRole,
	setTempPassphrase
} from '$lib/server/admin';
import { identityOf, PASSWORD_MAX, PASSWORD_MIN, type Secrets } from '$lib/server/auth';
import { loadSettings } from '$lib/server/settings';
import {
	formatDate,
	formatValue,
	loadFields,
	memberHistory,
	memberUnits,
	today
} from '$lib/server/stats';

export const load: PageServerLoad = async ({ platform, params, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const member = (await db.select().from(table.members).where(eq(table.members.id, params.id)))[0];
	if (!member) error(404, 'Not found');

	const identity = await identityOf(db, env as unknown as Secrets, params.id);
	const logins = await db
		.select({ kind: table.logins.kind })
		.from(table.logins)
		.where(eq(table.logins.memberId, params.id));
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	const { entries } = await memberHistory(db, params.id, 1, 500);
	const corrections = await db
		.select()
		.from(table.memberAudit)
		.where(eq(table.memberAudit.memberId, params.id))
		.orderBy(desc(table.memberAudit.date), desc(sql`rowid`));

	return {
		member: {
			id: member.id,
			status: member.status,
			isAdmin: member.isAdmin,
			name: identity.displayName || identity.handle || identity.username || '(no name on file)',
			username: identity.username ?? null,
			handle: identity.handle ?? null,
			doors: logins
				.map((l) => l.kind)
				.sort()
				.join(' + ')
		},
		hasPasswordDoor: logins.some((l) => l.kind === 'password'),
		passwordMin: PASSWORD_MIN,
		fieldNames: fields.map((f) => f.name),
		entries: entries.map(({ entry, values }) => ({
			dateLabel: formatDate(entry.date),
			cells: fields.map((field) => {
				const value = values.find((v) => v.fieldId === field.id);
				return value ? formatValue(field, value, units) : '';
			})
		})),
		corrections: corrections.map((c) => ({
			date: c.date,
			action: c.action,
			entryDate: c.entryDate
		}))
	};
};

const guard = (locals: App.Locals) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	return locals.member;
};

export const actions: Actions = {
	approve: async ({ locals, platform, params }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const settings = await loadSettings(db);
		await approveMember(db, today(settings.timezone), actor.memberId, params.id);
		redirect(303, `/admin/members/${params.id}`);
	},

	deny: async ({ locals, platform, params }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const settings = await loadSettings(db);
		const ok = await denyMember(db, today(settings.timezone), actor.memberId, params.id);
		if (!ok) return fail(400, { message: 'Only a pending registration can be denied.' });
		redirect(303, '/admin/members');
	},

	role: async ({ request, locals, platform, params }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const makeAdmin = (await request.formData()).get('make') === 'admin';
		const settings = await loadSettings(db);
		const result = await setAdminRole(
			db,
			today(settings.timezone),
			actor.memberId,
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
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const passphrase = String((await request.formData()).get('passphrase') ?? '');
		const settings = await loadSettings(db);
		const result = await setTempPassphrase(
			db,
			today(settings.timezone),
			actor.memberId,
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

	purge: async ({ locals, platform, params }) => {
		const actor = guard(locals);
		const db = getDb(platform!.env.DB);
		const settings = await loadSettings(db);
		await purgeMember(db, today(settings.timezone), actor.memberId, params.id);
		redirect(303, '/admin/members');
	}
};
