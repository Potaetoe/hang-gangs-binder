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
import { loadFields, today } from '$lib/server/stats';
import { trendSet } from '$lib/server/settings';

const OFFICIAL_SLOTS = 4;

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform!.env.DB);
	const settings = await loadSettings(db);
	const chosen = trendSet(settings);
	return {
		settings,
		// Which number fields carry trend lines (owner ruling 2026-08-26).
		trendChoices: (await loadFields(db))
			.filter((f) => f.type === 'number')
			.map((f) => ({ id: f.id, name: f.name, on: chosen.has(f.id) })),
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

		// The trend checkboxes: only real number fields count, kept in
		// the form's own order (owner ruling 2026-08-26).
		const ticked = new Set(form.getAll('trend').filter((v): v is string => typeof v === 'string'));
		const trendIds = (await loadFields(db))
			.filter((f) => f.type === 'number' && ticked.has(f.id))
			.map((f) => f.id);

		const next: SiteSettings = {
			siteName: String(form.get('site_name') ?? '')
				.trim()
				.slice(0, 60),
			welcomeText: String(form.get('welcome_text') ?? '')
				.trim()
				.slice(0, 400),
			timezone: String(form.get('timezone') ?? '').trim(),
			theme: String(form.get('theme') ?? 'auto'),
			socialLinks: JSON.stringify(official),
			trendFields: JSON.stringify(trendIds)
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
		for (const prop of [
			'siteName',
			'welcomeText',
			'timezone',
			'theme',
			'socialLinks',
			'trendFields'
		] as const) {
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
									: prop === 'trendFields'
										? 'trend graphs'
										: prop
					}`,
					null,
					prop === 'welcomeText'
						? null
						: prop === 'socialLinks'
							? `${official.length} link${official.length === 1 ? '' : 's'}`
							: prop === 'trendFields'
								? `${trendIds.length} field${trendIds.length === 1 ? '' : 's'}`
								: next[prop]
				);
			}
		}
		return { done: 'Saved.' };
	}
};
