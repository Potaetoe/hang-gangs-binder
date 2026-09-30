import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings, themeCss } from '$lib/server/settings';

/** The palette is the member's own choice (a device cookie) over the
 * admin's site default; empty css means follow the device. */
export const load: LayoutServerLoad = async ({ platform, locals, cookies }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	const theme = cookies.get('theme') || settings.theme;
	const isAdmin = locals.member?.isAdmin ?? false;
	return {
		siteName: settings.siteName,
		welcomeText: settings.welcomeText,
		theme,
		themeCss: themeCss(theme),
		cspNonce: locals.cspNonce,
		isAdmin,
		// Mobile Admin Mode: the Admin door on the phone rail for one
		// sitting, held in a cookie that dies with the browser.
		adminDoor: isAdmin && cookies.get('admin_door') === 'here'
	};
};
