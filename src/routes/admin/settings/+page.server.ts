import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/admin';
import { loadSettings, saveSetting, THEME_CHOICES, type SiteSettings } from '$lib/server/settings';
import { today } from '$lib/server/stats';

export const load: PageServerLoad = async ({ platform }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	return { settings, themeChoices: THEME_CHOICES };
};

const validTimezone = (tz: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

export const actions: Actions = {
	save: async ({ request, locals, platform }) => {
		if (!locals.member?.isAdmin) redirect(303, '/home');
		const db = getDb(platform!.env.DB);
		const form = await request.formData();

		const next: SiteSettings = {
			siteName: String(form.get('site_name') ?? '')
				.trim()
				.slice(0, 60),
			welcomeText: String(form.get('welcome_text') ?? '')
				.trim()
				.slice(0, 400),
			timezone: String(form.get('timezone') ?? '').trim(),
			theme: String(form.get('theme') ?? 'auto')
		};
		if (!next.siteName) return fail(400, { message: 'The site needs a name.' });
		if (!validTimezone(next.timezone)) {
			return fail(400, { message: `"${next.timezone}" is not a timezone the server knows.` });
		}
		if (!THEME_CHOICES.includes(next.theme)) {
			return fail(400, { message: 'Pick one of the shipped palettes.' });
		}

		const current = await loadSettings(db);
		const date = today(current.timezone);
		for (const prop of ['siteName', 'welcomeText', 'timezone', 'theme'] as const) {
			if (current[prop] !== next[prop]) {
				await saveSetting(db, prop, next[prop]);
				await logAdmin(
					db,
					date,
					locals.member.memberId,
					`changed the ${prop === 'siteName' ? 'site name' : prop === 'welcomeText' ? 'welcome text' : prop}`,
					null,
					prop === 'welcomeText' ? null : next[prop]
				);
			}
		}
		return { done: 'Saved.' };
	}
};
