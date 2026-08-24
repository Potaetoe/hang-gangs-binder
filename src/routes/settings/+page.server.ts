import { redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { PALETTES } from '$lib/server/settings';

/** The member's own settings (owner ruling 2026-08-24): device-level
 * choices, stored in cookies like the units toggle - the admin's
 * site settings stay the default for anyone who has not chosen. One
 * tap saves; there is no Save button. */
export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	// Telegram-only members have no password to change (owner,
	// 2026-08-24) - the card only shows where the door exists.
	const passwordLogin = (
		await db
			.select({ kind: table.logins.kind })
			.from(table.logins)
			.where(
				and(eq(table.logins.memberId, locals.member.memberId), eq(table.logins.kind, 'password'))
			)
	)[0];
	return {
		myTheme: cookies.get('theme') ?? '',
		myUnits: cookies.get('units') === 'metric' ? 'metric' : 'imperial',
		themeChoices: ['', ...Object.keys(PALETTES)],
		hasPasswordDoor: Boolean(passwordLogin)
	};
};

const COOKIE = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: true,
	maxAge: 400 * 86_400
} as const;

export const actions: Actions = {
	theme: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const theme = String((await request.formData()).get('theme') ?? '');
		if (theme && theme in PALETTES) {
			cookies.set('theme', theme, COOKIE);
		} else {
			cookies.delete('theme', { path: '/' });
		}
		redirect(303, '/settings');
	},

	units: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		cookies.set('units', form.get('units') === 'metric' ? 'metric' : 'imperial', COOKIE);
		redirect(303, '/settings');
	}
};
