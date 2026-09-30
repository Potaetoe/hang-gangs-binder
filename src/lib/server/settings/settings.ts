import type { Db } from '../db';
import * as table from '../db/schema';
import { dayIn } from '../days';
import { PALETTES } from './palettes';

export type SiteSettings = {
	siteName: string;
	welcomeText: string;
	timezone: string;
	theme: string;
	/** JSON [{label, url}], the group's old link slots. Replaced by
	 * socialsMessage but still read until a message is saved, so a site
	 * that set links before the message existed keeps them. */
	socialLinks: string;
	/** Admin-written HTML for the Socials page, cleaned to an allowlist
	 * on save and again on render (socials/message.ts). */
	socialsMessage: string;
	/** JSON string[] of the field ids that carry trend lines. */
	trendFields: string;
};

export const DEFAULTS: SiteSettings = {
	siteName: 'Hang Gang',
	welcomeText: 'Sign in once — then it is your page to fill in, and everyone’s numbers to read.',
	timezone: 'America/Chicago',
	theme: 'auto',
	socialLinks: '[]',
	socialsMessage: '',
	// Weight and BMI move; adult height does not.
	trendFields: '["weight","bmi"]'
};

const KEYS: Record<keyof SiteSettings, string> = {
	siteName: 'site_name',
	welcomeText: 'welcome_text',
	timezone: 'timezone',
	theme: 'theme',
	socialLinks: 'social_links',
	socialsMessage: 'socials_message',
	trendFields: 'trend_fields'
};

export async function loadSettings(db: Db): Promise<SiteSettings> {
	const rows = await db.select().from(table.settings);
	const byKey = new Map(rows.map((r) => [r.key, r.value]));
	const out = { ...DEFAULTS };
	for (const [prop, key] of Object.entries(KEYS) as [keyof SiteSettings, string][]) {
		const value = byKey.get(key);
		if (value != null && value !== '') out[prop] = value;
	}
	if (!(out.theme in PALETTES)) out.theme = 'auto';
	return out;
}

export async function saveSetting(db: Db, prop: keyof SiteSettings, value: string) {
	await db
		.insert(table.settings)
		.values({ key: KEYS[prop], value })
		.onConflictDoUpdate({ target: table.settings.key, set: { value } });
}

/** Today on the site's calendar, which dates every entry and log line. */
export async function siteDay(db: Db): Promise<string> {
	return dayIn((await loadSettings(db)).timezone);
}

export function trendSet(settings: SiteSettings): Set<string> {
	try {
		const parsed: unknown = JSON.parse(settings.trendFields || '[]');
		return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
	} catch {
		return new Set(['weight', 'bmi']);
	}
}

/** Where the group actually lives, US first. */
export const TIMEZONE_CHOICES: { id: string; name: string }[] = [
	{ id: 'America/New_York', name: 'US Eastern (New York)' },
	{ id: 'America/Chicago', name: 'US Central (Chicago)' },
	{ id: 'America/Denver', name: 'US Mountain (Denver)' },
	{ id: 'America/Phoenix', name: 'US Arizona (Phoenix)' },
	{ id: 'America/Los_Angeles', name: 'US Pacific (Los Angeles)' },
	{ id: 'America/Anchorage', name: 'US Alaska (Anchorage)' },
	{ id: 'Pacific/Honolulu', name: 'US Hawaii (Honolulu)' },
	{ id: 'America/Toronto', name: 'Canada Eastern (Toronto)' },
	{ id: 'America/Vancouver', name: 'Canada Pacific (Vancouver)' },
	{ id: 'America/Mexico_City', name: 'Mexico (Mexico City)' },
	{ id: 'America/Sao_Paulo', name: 'Brazil (Sao Paulo)' },
	{ id: 'Europe/London', name: 'UK and Ireland (London)' },
	{ id: 'Europe/Berlin', name: 'Central Europe (Berlin)' },
	{ id: 'Australia/Sydney', name: 'Australia East (Sydney)' },
	{ id: 'Asia/Tokyo', name: 'Japan (Tokyo)' },
	{ id: 'UTC', name: 'UTC' }
];
