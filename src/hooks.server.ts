import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { SESSION_COOKIE, sessionMember } from '$lib/server/auth';
import { randomToken } from '$lib/server/crypto';

/** A single-file bundle's stack can run to hundreds of kilobytes, and
 * anyone who can provoke an error could turn that into a flood. The top
 * frames are where the answer is. */
const LOG_MAX = 2000;

/**
 * The app's only log line (DESIGN.md, privacy model): an unexpected
 * error's route shape and message, never a URL, member id or name.
 * Redirects and deliberate error() responses never reach here.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	// A path that matched no route lands here too, and its message holds
	// the requested path, which can carry an entry id. Strays are not
	// crashes: log nothing.
	if (!event.route.id) return { message: 'Not found' };
	const raw = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
	const text = raw.length > LOG_MAX ? `${raw.slice(0, LOG_MAX)}… [${raw.length} chars]` : raw;
	console.error(`unexpected ${status} on ${event.route.id}: ${text}`);
	return { message: 'Something broke on our side. Try again in a minute.' };
};

/**
 * Pages ship almost no script: three small static files served from
 * 'self', and Telegram's sign-in widget with the frame it opens. The
 * palette's inline <style> gets a per-request nonce, so no other inline
 * style can ride along.
 */
const cspWith = (nonce: string) =>
	[
		"default-src 'self'",
		"script-src 'self' https://telegram.org",
		'frame-src https://oauth.telegram.org',
		`style-src 'self' 'nonce-${nonce}'`,
		"font-src 'self'",
		"img-src 'self' data: https://telegram.org",
		"connect-src 'self'",
		// A copied page cannot be made to post a member's entry elsewhere.
		"form-action 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"object-src 'none'"
	].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
	// A private group's binder belongs in no search index.
	'X-Robots-Tag': 'noindex, nofollow',
	'X-Content-Type-Options': 'nosniff',
	// Telegram checks the origin of the page hosting its widget, so the
	// origin still goes out, but never the path, where ids live.
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'Permissions-Policy':
		'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
};

/**
 * Who may reach a route is decided by the folder it lives in. Every
 * request passes through here, form actions included, which layout
 * loads do not guarantee. Routes in neither group guard themselves: the
 * test hooks, and the event image endpoint, which answers strangers
 * with a plain 404.
 */
function gate(routeId: string, member: App.Locals['member']) {
	if (!routeId.startsWith('/(member)')) return;
	if (!member) redirect(303, '/');
	if (routeId.startsWith('/(member)/admin') && !member.isAdmin) redirect(303, '/home');
}

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	event.locals.cspNonce = randomToken(16);
	event.locals.member = env
		? await sessionMember(getDb(env.DB), event.cookies.get(SESSION_COOKIE))
		: null;

	gate(event.route.id ?? '', event.locals.member);
	// A temporary passphrase walls off everything until the member picks
	// their own password.
	const path = event.url.pathname;
	if (event.locals.member?.mustChange && path !== '/password' && path !== '/signout') {
		redirect(303, '/password');
	}

	const response = await resolve(event);
	response.headers.set('Content-Security-Policy', cspWith(event.locals.cspNonce));
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	// A signed-in page is one member's data and belongs in no shared
	// cache. Event images are the exception: group data under a random,
	// never-reused id, so the member's own browser may keep them.
	if (event.locals.member && !path.startsWith('/_app/')) {
		response.headers.set(
			'Cache-Control',
			path.startsWith('/events/image/')
				? 'private, max-age=31536000, immutable'
				: 'private, no-store'
		);
	}
	return response;
};
