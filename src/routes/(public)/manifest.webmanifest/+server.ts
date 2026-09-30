import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings, PALETTES } from '$lib/server/settings';

/** The binder installs as a home-screen app. The manifest is built per
 * request so a fork's own name and palette flow into it. There is no
 * service worker, because the pages ship no JavaScript. */
export const GET: RequestHandler = async ({ platform }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	// 'auto' has no single palette; the splash takes midnight's.
	const bg = (PALETTES[settings.theme] ?? PALETTES.midnight)['--color-bg'];
	const manifest = {
		name: `${settings.siteName} Binder`,
		short_name: settings.siteName,
		start_url: '/home',
		scope: '/',
		display: 'standalone',
		background_color: bg,
		theme_color: bg,
		icons: [
			{ src: '/icons/binder-192.png', sizes: '192x192', type: 'image/png' },
			{ src: '/icons/binder-512.png', sizes: '512x512', type: 'image/png' },
			// Android crops launcher icons into circles; this one keeps the
			// letters inside the safe zone.
			{
				src: '/icons/binder-maskable-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			}
		]
	};
	return new Response(JSON.stringify(manifest), {
		headers: {
			'content-type': 'application/manifest+json',
			'cache-control': 'public, max-age=3600'
		}
	});
};
