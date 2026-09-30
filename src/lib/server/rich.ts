/**
 * The admin-written Socials message (owner rulings 2026-09-30): HTML
 * the admins type, cut down to a safe allowlist - structure, emphasis
 * and https links, nothing that runs, loads, or styles. It is cleaned
 * on save AND again on render, so a row that reached the database by
 * any other road still cannot put anything else on a member's page.
 * The CSP stays exactly as the security review left it.
 *
 * js-xss (MIT, pure JS - no Node built-ins, so it runs in a Worker).
 */

import * as xssModule from 'xss';
import { parseOfficialLinks, type OfficialLink } from './socials';
import type { SiteSettings } from './settings';

// js-xss is CommonJS and builds its exports at runtime, so a bundler
// may hand it over as the namespace or as its default - take either.
const xss: typeof xssModule =
	(xssModule as typeof xssModule & { default?: typeof xssModule }).default ?? xssModule;
const { escapeAttrValue, escapeHtml, FilterXSS, friendlyAttrValue } = xss;

export const MESSAGE_MAX = 8000;

/** Every tag a message may use, and the attributes each keeps. */
const ALLOWED: Record<string, string[]> = {
	h2: [],
	h3: [],
	h4: [],
	p: [],
	br: [],
	hr: [],
	strong: [],
	b: [],
	em: [],
	i: [],
	u: [],
	s: [],
	blockquote: [],
	ul: [],
	ol: [],
	li: [],
	code: [],
	a: ['href', 'title']
};

/** Tag names shown to the admin beside the box. */
export const ALLOWED_TAGS = Object.keys(ALLOWED);

/** Tags whose CONTENTS go too, not just the tag - a script's text
 * printed as words would be its own kind of mess. */
const DROP_WITH_BODY = [
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'template',
	'noscript',
	'textarea',
	'title',
	'svg',
	'math',
	'select'
];

const filter = new FilterXSS({
	whiteList: ALLOWED,
	stripIgnoreTag: true,
	stripIgnoreTagBody: DROP_WITH_BODY,
	allowCommentTag: false,
	onTagAttr(tag, name, value) {
		if (tag !== 'a' || name !== 'href') return undefined;
		// Links are whole https addresses, like the socials the members
		// list - anything else (javascript:, data:, relative) loses its
		// href and stays behind as plain words.
		try {
			const url = new URL(friendlyAttrValue(value).trim());
			if (url.protocol !== 'https:') return '';
			return `href="${escapeAttrValue(url.href)}"`;
		} catch {
			return '';
		}
	}
});

/** The message cut to the allowlist - what is stored, and what the
 * admin's box shows back, so they see exactly what survived. */
export function cleanMessage(raw: string): string {
	return filter.process(raw.slice(0, MESSAGE_MAX)).trim();
}

/** Ready for a page: cleaned again, and every link opens in a new tab
 * handing the destination nothing about where it came from. The
 * cleaned text holds only allowlisted tags with escaped attributes,
 * so `<a` can only begin a real link tag here. */
export function renderMessage(raw: string): string {
	return cleanMessage(raw).replace(/<a(?=[\s>])/g, '<a target="_blank" rel="noreferrer noopener"');
}

/** Before the message existed, the group kept up to four label+link
 * pairs. A site that has those and no message yet reads them as a
 * list, so nothing the admins entered goes missing. */
export function linksAsMessage(links: OfficialLink[]): string {
	if (!links.length) return '';
	const items = links
		.map((l) => `<li><a href="${escapeAttrValue(l.url)}">${escapeHtml(l.label)}</a></li>`)
		.join('\n');
	return `<ul>\n${items}\n</ul>`;
}

/** The message in force: the saved one, or the old links while no
 * message has been saved yet - cleaned either way. Feed it to
 * renderMessage for a page. */
export function socialsMessageOf(settings: SiteSettings): string {
	return cleanMessage(
		settings.socialsMessage || linksAsMessage(parseOfficialLinks(settings.socialLinks))
	);
}
