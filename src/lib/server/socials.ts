/**
 * Member socials (DESIGN.md feature 6, owner rulings 2026-08-26).
 * The links are real identities, so everything here treats them like
 * names: sealed under the directory secret, opened only to render a
 * page, never written anywhere plain. Handles for X and Tumblr (the
 * binder builds the link), whole URLs for Feabie, FetLife and the
 * one labelled Other.
 */

import { asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as table from './db/schema';
import { open, seal } from './crypto';
import { allIdentities, type Secrets } from './auth';

type Db = DrizzleD1Database<typeof import('./db/schema')>;

export type SocialLinks = {
	x?: string;
	tumblr?: string;
	feabie?: string;
	fetlife?: string;
	other?: { label: string; url: string };
};

const HANDLE_SHAPE = /^[A-Za-z0-9_.-]{1,30}$/;
const LABEL_MAX = 24;
const URL_MAX = 180;

/** Every sealed payload lands in the same 1 KB bucket: the JSON is
 * pre-padded past the seal's 256-byte blocks, so one link and five
 * links are indistinguishable in the database. The length caps above
 * keep the honest maximum inside the bucket. */
const BUCKET_PAD = 769;

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** An https URL on the platform's own domain, or null. */
function platformUrl(raw: string, domain: string | null): string | null {
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:') return null;
		if (raw.length > URL_MAX) return null;
		if (domain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return null;
		return url.href;
	} catch {
		return null;
	}
}

export type ParsedSocials =
	{ ok: true; links: SocialLinks | null } | { ok: false; problems: string[] };

/** Reads the settings form; every fault at once. All five slots
 * optional - all of them blank means "no links", which deletes the
 * row and takes the member off the roster. */
export function parseSocialsForm(form: FormData): ParsedSocials {
	const problems: string[] = [];
	const links: SocialLinks = {};

	for (const key of ['x', 'tumblr'] as const) {
		const raw = String(form.get(`s_${key}`) ?? '')
			.trim()
			.replace(/^@/, '');
		if (!raw) continue;
		if (!HANDLE_SHAPE.test(raw)) {
			problems.push(`${key === 'x' ? 'X' : 'Tumblr'}: that does not read as a handle.`);
			continue;
		}
		links[key] = raw;
	}
	for (const [key, domain, name] of [
		['feabie', 'feabie.com', 'Feabie'],
		['fetlife', 'fetlife.com', 'FetLife']
	] as const) {
		const raw = String(form.get(`s_${key}`) ?? '').trim();
		if (!raw) continue;
		const url = platformUrl(raw, domain);
		if (!url) {
			problems.push(`${name}: paste the whole https link to your ${domain} profile.`);
			continue;
		}
		links[key] = url;
	}
	const otherLabel = String(form.get('s_other_label') ?? '').trim();
	const otherUrl = String(form.get('s_other_url') ?? '').trim();
	if (otherLabel || otherUrl) {
		const url = otherUrl ? platformUrl(otherUrl, null) : null;
		if (!otherLabel || otherLabel.length > LABEL_MAX) {
			problems.push(`Other: give it a short name (up to ${LABEL_MAX} characters).`);
		}
		if (!url) {
			problems.push('Other: paste a whole https link.');
		}
		if (otherLabel && otherLabel.length <= LABEL_MAX && url) {
			links.other = { label: otherLabel, url };
		}
	}

	if (problems.length) return { ok: false, problems };
	return { ok: true, links: Object.keys(links).length ? links : null };
}

/* ---------------------------------------------------------------- */
/* Sealed storage                                                    */

export async function socialsOf(
	db: Db,
	secrets: Secrets,
	memberId: string
): Promise<SocialLinks | null> {
	const row = (
		await db.select().from(table.socials).where(eq(table.socials.memberId, memberId))
	)[0];
	if (!row) return null;
	// Loud on a wrong secret, like the directory: a record that cannot
	// be read must never be silently treated as absent and overwritten.
	return JSON.parse(await open(secrets.DIRECTORY_SECRET, row.sealed)) as SocialLinks;
}

/** True when the member has a socials row at all - the nudges only
 * need existence, which costs no unseal. */
export async function hasSocials(db: Db, memberId: string): Promise<boolean> {
	const row = (
		await db
			.select({ memberId: table.socials.memberId })
			.from(table.socials)
			.where(eq(table.socials.memberId, memberId))
	)[0];
	return Boolean(row);
}

export async function setSocials(
	db: Db,
	secrets: Secrets,
	memberId: string,
	links: SocialLinks | null
): Promise<void> {
	if (!links) {
		await db.delete(table.socials).where(eq(table.socials.memberId, memberId));
		return;
	}
	const sealed = await seal(
		secrets.DIRECTORY_SECRET,
		JSON.stringify(links).padEnd(BUCKET_PAD, ' ')
	);
	await db
		.insert(table.socials)
		.values({ memberId, sealed, updatedAt: todayUtc() })
		.onConflictDoUpdate({ target: table.socials.memberId, set: { sealed, updatedAt: todayUtc() } });
}

/** The admin lever (owner ruling 2026-08-26): the row goes, the
 * change log line is the caller's job. */
export async function clearSocials(db: Db, memberId: string): Promise<void> {
	await db.delete(table.socials).where(eq(table.socials.memberId, memberId));
}

/* ---------------------------------------------------------------- */
/* The roster                                                        */

export type SocialLinkView = { key: string; badge: string; name: string; href: string };
export type RosterRow = { name: string; links: SocialLinkView[] };

/** Each stored link turned into what the row shows: a letter badge
 * and where it goes. Handles become their platform's profile URL. */
export function linkViews(links: SocialLinks): SocialLinkView[] {
	const views: SocialLinkView[] = [];
	if (links.x)
		views.push({ key: 'x', badge: 'X', name: `X — @${links.x}`, href: `https://x.com/${links.x}` });
	if (links.tumblr) {
		views.push({
			key: 'tumblr',
			badge: 't',
			name: `Tumblr — ${links.tumblr}`,
			href: `https://www.tumblr.com/${links.tumblr}`
		});
	}
	if (links.feabie) views.push({ key: 'feabie', badge: 'F', name: 'Feabie', href: links.feabie });
	if (links.fetlife)
		views.push({ key: 'fetlife', badge: 'FL', name: 'FetLife', href: links.fetlife });
	if (links.other)
		views.push({ key: 'other', badge: '∞', name: links.other.label, href: links.other.url });
	return views;
}

/** Every APPROVED member with links, unsealed for display and sorted
 * by name - the page's whole roster. Three fixed queries however many
 * members there are: it used to unseal one directory row per listed
 * member, and its approved-filter carried one bound id per row, which
 * would have hit D1's per-query parameter cap at scale (hardening
 * pass, 2026-08-26). */
export async function socialsRoster(db: Db, secrets: Secrets): Promise<RosterRow[]> {
	const rows = await db.select().from(table.socials).orderBy(asc(table.socials.memberId));
	if (!rows.length) return [];
	const approved = new Set(
		(
			await db
				.select({ id: table.members.id })
				.from(table.members)
				.where(eq(table.members.status, 'approved'))
		).map((m) => m.id)
	);
	const identities = await allIdentities(db, secrets);
	const out: RosterRow[] = [];
	for (const row of rows) {
		if (!approved.has(row.memberId)) continue;
		const identity = identities.get(row.memberId) ?? {};
		const links = JSON.parse(await open(secrets.DIRECTORY_SECRET, row.sealed)) as SocialLinks;
		const views = linkViews(links);
		if (!views.length) continue;
		out.push({
			name: identity.displayName || identity.handle || identity.username || 'a member',
			links: views
		});
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/* ---------------------------------------------------------------- */
/* The group's own links, from settings                              */

export type OfficialLink = { label: string; url: string };

export function parseOfficialLinks(raw: string): OfficialLink[] {
	try {
		const parsed: unknown = JSON.parse(raw || '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(l): l is OfficialLink =>
					typeof l === 'object' &&
					l !== null &&
					typeof (l as OfficialLink).label === 'string' &&
					typeof (l as OfficialLink).url === 'string'
			)
			.slice(0, 4);
	} catch {
		return [];
	}
}
