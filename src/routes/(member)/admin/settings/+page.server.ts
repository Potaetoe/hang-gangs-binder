import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { logAdmin } from '$lib/server/changelog';
import {
	loadSettings,
	saveSetting,
	THEME_CHOICES,
	TIMEZONE_CHOICES,
	trendSet,
	type SiteSettings
} from '$lib/server/settings';
import {
	ALLOWED_TAGS,
	cleanMessage,
	MESSAGE_MAX,
	renderMessage,
	socialsMessageOf
} from '$lib/server/socials';
import { loadFields } from '$lib/server/fields';
import { dayIn, validTimezone } from '$lib/server/days';

export const load: PageServerLoad = async ({ platform }) => {
	const db = getDb(platform!.env.DB);
	const settings = await loadSettings(db);
	const chosen = trendSet(settings);
	const message = socialsMessageOf(settings);
	return {
		settings,
		trendChoices: (await loadFields(db))
			.filter((f) => f.type === 'number')
			.map((f) => ({ id: f.id, name: f.name, on: chosen.has(f.id) })),
		// The box holds exactly what members see, so the admin sees at once
		// what the allowlist kept.
		socialsMessage: message,
		socialsPreview: renderMessage(message),
		allowedTags: ALLOWED_TAGS,
		messageMax: MESSAGE_MAX,
		themeChoices: THEME_CHOICES,
		timezoneChoices: TIMEZONE_CHOICES
	};
};

/** How each setting is named in the change log. */
const LOG_NAMES: Partial<Record<keyof SiteSettings, string>> = {
	siteName: 'site name',
	welcomeText: 'welcome text',
	timezone: 'timezone',
	theme: 'theme',
	socialsMessage: 'Socials message',
	trendFields: 'trend graphs'
};

export const actions: Actions = {
	save: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const text = (key: string) => String(form.get(key) ?? '').trim();

		// Too long is refused whole, never silently cut.
		const rawMessage = String(form.get('socials_message') ?? '');
		if (rawMessage.length > MESSAGE_MAX) {
			return fail(400, { message: `The Socials message tops out at ${MESSAGE_MAX} characters.` });
		}
		// Only real number fields count, kept in form order.
		const ticked = new Set(form.getAll('trend').map(String));
		const trendIds = (await loadFields(db))
			.filter((f) => f.type === 'number' && ticked.has(f.id))
			.map((f) => f.id);

		const next = {
			siteName: text('site_name').slice(0, 60),
			welcomeText: text('welcome_text').slice(0, 400),
			timezone: text('timezone'),
			theme: String(form.get('theme') ?? 'auto'),
			socialsMessage: cleanMessage(rawMessage),
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
		const date = dayIn(current.timezone);
		for (const prop of Object.keys(next) as (keyof typeof next)[]) {
			// The message compares against what members were shown, so a site
			// still on the old links logs the switch once, not every save.
			const before = prop === 'socialsMessage' ? socialsMessageOf(current) : current[prop];
			if (before === next[prop]) continue;
			// Long texts log that they changed, not what they now say.
			const detail =
				prop === 'trendFields'
					? `${trendIds.length} field${trendIds.length === 1 ? '' : 's'}`
					: prop === 'welcomeText' || prop === 'socialsMessage'
						? null
						: next[prop];
			await saveSetting(db, prop, next[prop]);
			await logAdmin(
				db,
				date,
				locals.member!.memberId,
				`changed the ${LOG_NAMES[prop]}`,
				null,
				detail
			);
		}
		// Retire the old link slots for good, or an emptied message would
		// bring them back as the fallback.
		if (current.socialLinks !== '[]') await saveSetting(db, 'socialLinks', '[]');
		return { done: 'Saved.' };
	}
};
