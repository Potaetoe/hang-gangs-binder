/**
 * The admin-written panel on the Socials page. It is HTML cut down to an
 * allowlist: structure, emphasis and https links, nothing that runs,
 * loads or styles. It is cleaned on save and again on render, so a row
 * that reached the database any other way still cannot put anything
 * else on a member's page. The CSP is left strict either way.
 */

import * as xssModule from 'xss';
import type { SiteSettings } from '../settings';

// js-xss is CommonJS, so a bundler may hand over the namespace or its
// default. It needs no Node built-ins, which is why it runs in a Worker.
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

export const ALLOWED_TAGS = Object.keys(ALLOWED);

/** Tags whose contents go too: a script's source printed as words would
 * be its own kind of mess. */
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
		// Whole https addresses only, like the members' own links. Anything
		// else loses its href and stays behind as plain words.
		try {
			const url = new URL(friendlyAttrValue(value).trim());
			return url.protocol === 'https:' ? `href="${escapeAttrValue(url.href)}"` : '';
		} catch {
			return '';
		}
	}
});

/** What is stored, and what the admin's box shows back, so they see
 * exactly what survived. */
export function cleanMessage(raw: string): string {
	return filter.process(raw.slice(0, MESSAGE_MAX)).trim();
}

/** Cleaned again, with every link opening in a new tab that learns
 * nothing about where it came from. After cleaning, `<a` can only start
 * a real link tag. */
export function renderMessage(raw: string): string {
	return cleanMessage(raw).replace(/<a(?=[\s>])/g, '<a target="_blank" rel="noreferrer noopener"');
}

type OldLink = { label: string; url: string };

/** The four label+link slots the message replaced, as a list. */
function oldLinksAsHtml(raw: string): string {
	let links: OldLink[] = [];
	try {
		const parsed: unknown = JSON.parse(raw || '[]');
		if (Array.isArray(parsed)) {
			links = parsed.filter(
				(l): l is OldLink => typeof l?.label === 'string' && typeof l?.url === 'string'
			);
		}
	} catch {
		return '';
	}
	if (!links.length) return '';
	const items = links
		.slice(0, 4)
		.map((l) => `<li><a href="${escapeAttrValue(l.url)}">${escapeHtml(l.label)}</a></li>`);
	return `<ul>\n${items.join('\n')}\n</ul>`;
}

/** The message in force: the saved one, or the old links until a message
 * is saved, so nothing the admins entered goes missing. */
export function socialsMessageOf(settings: SiteSettings): string {
	return cleanMessage(settings.socialsMessage || oldLinksAsHtml(settings.socialLinks));
}
