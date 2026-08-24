import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PALETTES } from '$lib/server/settings';

/** The member's own settings (owner ruling 2026-08-24): device-level
 * choices, stored in cookies like the units toggle - the admin's
 * site settings stay the default for anyone who has not chosen. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.member) redirect(303, '/');
	return {
		myTheme: cookies.get('theme') ?? '',
		myUnits: cookies.get('units') === 'metric' ? 'metric' : 'imperial',
		themeChoices: ['', ...Object.keys(PALETTES)]
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
	save: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		const theme = String(form.get('theme') ?? '');
		if (theme && theme in PALETTES) {
			cookies.set('theme', theme, COOKIE);
		} else {
			cookies.delete('theme', { path: '/' });
		}
		cookies.set('units', form.get('units') === 'metric' ? 'metric' : 'imperial', COOKIE);
		redirect(303, '/settings');
	}
};
