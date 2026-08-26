import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/admin';
import {
	loadSettings,
	saveSetting,
	THEME_CHOICES,
	TIMEZONE_CHOICES,
	type SiteSettings
} from '$lib/server/settings';
import { parseOfficialLinks, type OfficialLink } from '$lib/server/socials';
import { today } from '$lib/server/stats';

const OFFICIAL_SLOTS = 4;

export const load: PageServerLoad = async ({ platform }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	return {
		settings,
		officialLinks: parseOfficialLinks(settings.socialLinks),
		officialSlots: OFFICIAL_SLOTS,
		themeChoices: THEME_CHOICES,
		timezoneChoices: TIMEZONE_CHOICES
	};
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

		// The group's own links for the Socials page: four label+link
		// slots, blanks dropped, https only (owner ruling 2026-08-26).
		const official: OfficialLink[] = [];
		for (let slot = 1; slot <= OFFICIAL_SLOTS; slot++) {
			const label = String(form.get(`official_label_${slot}`) ?? '')
				.trim()
				.slice(0, 24);
			const url = String(form.get(`official_url_${slot}`) ?? '').trim();
			if (!label && !url) continue;
			try {
				if (!label || new URL(url).protocol !== 'https:') throw new Error();
			} catch {
				return fail(400, {
					message: `Group link ${slot} needs both a short name and a whole https link.`
				});
			}
			official.push({ label, url });
		}

		const next: SiteSettings = {
			siteName: String(form.get('site_name') ?? '')
				.trim()
				.slice(0, 60),
			welcomeText: String(form.get('welcome_text') ?? '')
				.trim()
				.slice(0, 400),
			timezone: String(form.get('timezone') ?? '').trim(),
			theme: String(form.get('theme') ?? 'auto'),
			socialLinks: JSON.stringify(official)
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
		for (const prop of ['siteName', 'welcomeText', 'timezone', 'theme', 'socialLinks'] as const) {
			if (current[prop] !== next[prop]) {
				await saveSetting(db, prop, next[prop]);
				await logAdmin(
					db,
					date,
					locals.member.memberId,
					`changed the ${
						prop === 'siteName'
							? 'site name'
							: prop === 'welcomeText'
								? 'welcome text'
								: prop === 'socialLinks'
									? 'group links'
									: prop
					}`,
					null,
					prop === 'welcomeText'
						? null
						: prop === 'socialLinks'
							? `${official.length} link${official.length === 1 ? '' : 's'}`
							: next[prop]
				);
			}
		}
		return { done: 'Saved.' };
	}
};
