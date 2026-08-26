import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings, PALETTES } from '$lib/server/settings';

/** The PWA shell (owner ruling 2026-08-26): the binder installs from
 * the share sheet as a home-screen app. The manifest is built per
 * request so a fork's own name and default palette flow into it. No
 * service worker - the pages stay no-JavaScript. */
export const GET: RequestHandler = async ({ platform }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	// 'auto' has no single palette; the splash takes midnight's dark.
	const bg = PALETTES[settings.theme]?.['--color-bg'] ?? PALETTES.midnight['--color-bg'];
	return new Response(
		JSON.stringify({
			name: `${settings.siteName} Binder`,
			short_name: settings.siteName,
			start_url: '/home',
			scope: '/',
			display: 'standalone',
			background_color: bg,
			theme_color: bg,
			icons: [
				{ src: '/icons/binder-192.png', sizes: '192x192', type: 'image/png' },
				{ src: '/icons/binder-512.png', sizes: '512x512', type: 'image/png' }
			]
		}),
		{
			headers: {
				'content-type': 'application/manifest+json',
				'cache-control': 'public, max-age=3600'
			}
		}
	);
};
