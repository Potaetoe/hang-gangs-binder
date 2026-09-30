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
import {
	ALLOWED_TAGS,
	cleanMessage,
	MESSAGE_MAX,
	renderMessage,
	socialsMessageOf
} from '$lib/server/rich';
import { loadFields, today } from '$lib/server/stats';
import { trendSet } from '$lib/server/settings';

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
		// The box holds exactly what members see - already cleaned, so
		// the admin sees at once what the allowlist kept.
		socialsMessage: socialsMessageOf(settings),
		socialsPreview: renderMessage(socialsMessageOf(settings)),
		allowedTags: ALLOWED_TAGS,
		messageMax: MESSAGE_MAX,
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

		// The group's panel on the Socials page (owner rulings
		// 2026-09-30): admin HTML, cleaned to the allowlist before it is
		// stored. Too long is refused whole, never silently cut.
		const rawMessage = String(form.get('socials_message') ?? '');
		if (rawMessage.length > MESSAGE_MAX) {
			return fail(400, {
				message: `The Socials message tops out at ${MESSAGE_MAX} characters.`
			});
		}
		const socialsMessage = cleanMessage(rawMessage);

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
			// Not written by the loop below - retired after it.
			socialLinks: '[]',
			socialsMessage,
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
			'socialsMessage',
			'trendFields'
		] as const) {
			// The message compares against what members were shown, so a
			// site on the old links logs the switch once, not every save.
			const before = prop === 'socialsMessage' ? socialsMessageOf(current) : current[prop];
			if (before !== next[prop]) {
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
								: prop === 'socialsMessage'
									? 'Socials message'
									: prop === 'trendFields'
										? 'trend graphs'
										: prop
					}`,
					null,
					prop === 'welcomeText' || prop === 'socialsMessage'
						? null
						: prop === 'trendFields'
							? `${trendIds.length} field${trendIds.length === 1 ? '' : 's'}`
							: next[prop]
				);
			}
		}
		// Retire the old link slots for good, or an emptied message would
		// bring them back as the fallback.
		if (current.socialLinks !== '[]') await saveSetting(db, 'socialLinks', '[]');
		return { done: 'Saved.' };
	}
};
