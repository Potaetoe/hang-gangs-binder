/**
 * Site settings (owner rulings 2026-08-24): rows in the settings
 * table, code defaults when a row is absent. The theme is one of the
 * four shipped palettes or 'auto' - daylight or midnight following
 * the device. No custom themes, by ruling.
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export type SiteSettings = {
	siteName: string;
	welcomeText: string;
	timezone: string;
	theme: string;
	/** JSON [{label, url}] — the group's own links on the Socials page
	 * (owner ruling 2026-08-26). Group data, nothing personal, so a
	 * plain setting is the right home. */
	socialLinks: string;
};

export const DEFAULTS: SiteSettings = {
	siteName: 'Hang Gang',
	welcomeText: 'Sign in once — then it is your page to fill in, and everyone’s numbers to read.',
	timezone: 'America/Chicago',
	theme: 'auto',
	socialLinks: '[]'
};

const KEYS: Record<keyof SiteSettings, string> = {
	siteName: 'site_name',
	welcomeText: 'welcome_text',
	timezone: 'timezone',
	theme: 'theme',
	socialLinks: 'social_links'
};

export async function loadSettings(db: Db): Promise<SiteSettings> {
	const rows = await db.select().from(table.settings);
	const byKey = new Map(rows.map((r) => [r.key, r.value]));
	const out = { ...DEFAULTS };
	for (const [prop, key] of Object.entries(KEYS) as [keyof SiteSettings, string][]) {
		const value = byKey.get(key);
		if (value != null && value !== '') out[prop] = value;
	}
	if (!(out.theme in PALETTES) && out.theme !== 'auto') out.theme = 'auto';
	return out;
}

export async function saveSetting(db: Db, prop: keyof SiteSettings, value: string) {
	const key = KEYS[prop];
	await db
		.insert(table.settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: table.settings.key, set: { value } });
}

/* ---------------------------------------------------------------- */
/* The four palettes (DESIGN.md "The look"). Midnight and daylight   */
/* carried from step 0; plum and meadow adapted from the old world's */
/* own palettes, in the same token set.                              */

export type Palette = Record<string, string>;

export const PALETTES: Record<string, Palette> = {
	midnight: {
		'color-scheme': 'dark',
		'--color-bg': '#120d10',
		'--color-surface': '#1c1417',
		'--color-accent': '#c73743',
		'--color-on-accent': '#fff7f1',
		'--color-text': '#f1e9e2',
		'--color-text-muted': '#bba9a6',
		'--color-border': '#4a3a40',
		'--color-border-strong': '#7a6870'
	},
	daylight: {
		'color-scheme': 'light',
		'--color-bg': '#f3eadb',
		'--color-surface': '#fbf5ea',
		'--color-accent': '#8e2530',
		'--color-on-accent': '#fbf1e4',
		'--color-text': '#2e2226',
		'--color-text-muted': '#61524b',
		'--color-border': '#d6c6b0',
		'--color-border-strong': '#857567'
	},
	plum: {
		'color-scheme': 'dark',
		'--color-bg': '#241b21',
		'--color-surface': '#322730',
		'--color-accent': '#e87fa8',
		'--color-on-accent': '#2a161f',
		'--color-text': '#f5e6ee',
		'--color-text-muted': '#bfa8b6',
		'--color-border': '#473942',
		'--color-border-strong': '#6f5a66'
	},
	meadow: {
		'color-scheme': 'light',
		'--color-bg': '#f2efe9',
		'--color-surface': '#faf8f4',
		'--color-accent': '#47613f',
		'--color-on-accent': '#f6f4ec',
		'--color-text': '#3a3d35',
		'--color-text-muted': '#6f7165',
		'--color-border': '#ddd8cb',
		'--color-border-strong': '#8f8a77'
	}
};

export const THEME_CHOICES = ['auto', ...Object.keys(PALETTES)];

/** Common zones for the settings dropdown (owner, 2026-08-24) -
 * matching where the group actually lives, US first. */
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

/** The <style> body that pins a palette; empty for 'auto', where the
 * stylesheet's own media query keeps following the device. The
 * doubled :root outranks both the stylesheet's base tokens and its
 * dark-mode media query, whatever order the head loads in. */
export function themeCss(theme: string): string {
	const palette = PALETTES[theme];
	if (!palette) return '';
	const lines = Object.entries(palette)
		.map(([k, v]) => `${k}: ${v};`)
		.join(' ');
	return `:root:root { ${lines} }`;
}
