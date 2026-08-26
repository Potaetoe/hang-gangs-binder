import { redirect, type Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { sessionMember } from '$lib/server/auth';

/**
 * What a browser is allowed to load. The pages ship no JavaScript of
 * their own, so the only script anywhere is Telegram's sign-in widget
 * and the frame it opens - everything else is refused outright.
 *
 * Styles are the one loose thread: the palette arrives as an inline
 * <style> in the layout head, so inline styles have to be allowed.
 * That block is built from the shipped palette map and never from
 * anything a person typed, and a style cannot execute code, so the
 * trade is small and deliberate.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self' https://telegram.org",
	'frame-src https://oauth.telegram.org',
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data: https://telegram.org",
	"connect-src 'self'",
	// Forms post to this site and nowhere else - a stolen page cannot
	// be made to send a member's entry somewhere off-site.
	"form-action 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"object-src 'none'"
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
	'Content-Security-Policy': CSP,
	// A private group's binder belongs in no search index. robots.txt
	// turns away crawlers that read it; this turns away the rest.
	'X-Robots-Tag': 'noindex, nofollow',
	'X-Content-Type-Options': 'nosniff',
	// Telegram checks the origin of the page hosting its widget, so the
	// origin still goes out cross-site - but never the path, which is
	// where member and entry ids live.
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'Permissions-Policy':
		'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	event.locals.member = env
		? await sessionMember(getDb(env.DB), event.cookies.get('session'))
		: null;
	// A temporary passphrase walls the whole site off until the member
	// picks their own password (owner ruling 2026-08-24).
	const path = event.url.pathname;
	if (
		event.locals.member?.mustChange &&
		!path.startsWith('/password') &&
		!path.startsWith('/signout')
	) {
		redirect(303, '/password');
	}
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}
	// A signed-in page is one member's data and belongs in no shared
	// cache, ever - not a proxy's, not a future CDN rule's. Static
	// assets are fingerprinted and left alone. Event images are the one
	// signed-in exception: group data under a random immutable id, so
	// the member's own browser may keep them - still `private`, so no
	// shared cache ever holds a byte.
	if (event.locals.member && !event.url.pathname.startsWith('/_app/')) {
		response.headers.set(
			'Cache-Control',
			event.url.pathname.startsWith('/events/image/')
				? 'private, max-age=31536000, immutable'
				: 'private, no-store'
		);
	}
	return response;
};
