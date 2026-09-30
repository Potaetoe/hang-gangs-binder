/**
 * Member links. They identify people as surely as names do, so they are
 * sealed under the directory secret and opened only to render a page.
 * X and Tumblr take handles (the binder builds the URL); Feabie, FetLife
 * and Other take whole https links.
 */

import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import * as table from '../db/schema';
import { open, seal } from '../crypto';
import { utcDay } from '../days';
import { allIdentities, nameOf } from '../identity';

export type SocialLinks = {
	x?: string;
	tumblr?: string;
	feabie?: string;
	fetlife?: string;
	other?: { label: string; url: string };
};

type DirectoryEnv = Pick<Env, 'DIRECTORY_SECRET'>;

const HANDLE_SHAPE = /^[A-Za-z0-9_.-]{1,30}$/;
const LABEL_MAX = 24;
const URL_MAX = 180;

/** Every payload is padded into the same 1 KB bucket before sealing, so
 * one link and five are indistinguishable in the database. The length
 * caps above keep the largest honest payload inside it. */
const BUCKET_PAD = 769;

/** A whole https URL, on the platform's own domain when one is given. */
function platformUrl(raw: string, domain: string | null): string | null {
	if (raw.length > URL_MAX) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:') return null;
		if (domain && url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Reads the Settings form, every fault at once. All blank means no
 * links, which takes the member off the roster. */
export function parseSocialsForm(
	form: FormData
): { ok: true; links: SocialLinks | null } | { ok: false; problems: string[] } {
	const text = (key: string) => String(form.get(key) ?? '').trim();
	const problems: string[] = [];
	const links: SocialLinks = {};

	for (const [key, name] of [
		['x', 'X'],
		['tumblr', 'Tumblr']
	] as const) {
		const handle = text(`s_${key}`).replace(/^@/, '');
		if (!handle) continue;
		if (HANDLE_SHAPE.test(handle)) links[key] = handle;
		else problems.push(`${name}: that does not read as a handle.`);
	}
	for (const [key, domain, name] of [
		['feabie', 'feabie.com', 'Feabie'],
		['fetlife', 'fetlife.com', 'FetLife']
	] as const) {
		const raw = text(`s_${key}`);
		if (!raw) continue;
		const url = platformUrl(raw, domain);
		if (url) links[key] = url;
		else problems.push(`${name}: paste the whole https link to your ${domain} profile.`);
	}
	const label = text('s_other_label');
	const otherRaw = text('s_other_url');
	if (label || otherRaw) {
		const url = otherRaw ? platformUrl(otherRaw, null) : null;
		const labelOk = label && label.length <= LABEL_MAX;
		if (!labelOk) problems.push(`Other: give it a short name (up to ${LABEL_MAX} characters).`);
		if (!url) problems.push('Other: paste a whole https link.');
		if (labelOk && url) links.other = { label, url };
	}

	if (problems.length) return { ok: false, problems };
	return { ok: true, links: Object.keys(links).length ? links : null };
}

/** Throws on a wrong secret, like the directory: a record that cannot be
 * read must never be mistaken for an absent one and overwritten. */
export async function socialsOf(
	db: Db,
	env: DirectoryEnv,
	memberId: string
): Promise<SocialLinks | null> {
	const [row] = await db.select().from(table.socials).where(eq(table.socials.memberId, memberId));
	return row ? (JSON.parse(await open(env.DIRECTORY_SECRET, row.sealed)) as SocialLinks) : null;
}

/** Existence only, which costs no unsealing. */
export async function hasSocials(db: Db, memberId: string): Promise<boolean> {
	const [row] = await db
		.select({ memberId: table.socials.memberId })
		.from(table.socials)
		.where(eq(table.socials.memberId, memberId));
	return Boolean(row);
}

/** Null clears them; so does the admin's moderation lever. */
export async function setSocials(
	db: Db,
	env: DirectoryEnv,
	memberId: string,
	links: SocialLinks | null
) {
	if (!links) {
		await db.delete(table.socials).where(eq(table.socials.memberId, memberId));
		return;
	}
	const sealed = await seal(env.DIRECTORY_SECRET, JSON.stringify(links).padEnd(BUCKET_PAD, ' '));
	const updatedAt = utcDay();
	await db
		.insert(table.socials)
		.values({ memberId, sealed, updatedAt })
		.onConflictDoUpdate({ target: table.socials.memberId, set: { sealed, updatedAt } });
}

export type SocialLinkView = { key: string; badge: string; name: string; href: string };
export type RosterRow = { name: string; links: SocialLinkView[] };

/** Each link as a letter badge and where it goes. */
function linkViews(links: SocialLinks): SocialLinkView[] {
	const views: SocialLinkView[] = [];
	if (links.x) {
		views.push({ key: 'x', badge: 'X', name: `X — @${links.x}`, href: `https://x.com/${links.x}` });
	}
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
	if (links.other) {
		views.push({ key: 'other', badge: '∞', name: links.other.label, href: links.other.url });
	}
	return views;
}

/** Every approved member with links, sorted by name. A fixed three
 * queries however many members there are. */
export async function socialsRoster(db: Db, env: DirectoryEnv): Promise<RosterRow[]> {
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
	const identities = await allIdentities(db, env);
	const roster: RosterRow[] = [];
	for (const row of rows) {
		if (!approved.has(row.memberId)) continue;
		const links = linkViews(
			JSON.parse(await open(env.DIRECTORY_SECRET, row.sealed)) as SocialLinks
		);
		if (links.length)
			roster.push({ name: nameOf(identities.get(row.memberId)) || 'a member', links });
	}
	return roster.sort((a, b) => a.name.localeCompare(b.name));
}
