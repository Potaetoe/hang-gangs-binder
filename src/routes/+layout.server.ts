import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings, themeCss } from '$lib/server/settings';

/** Every page carries the site's settings: the name on the brand, the
 * door's welcome line, and the palette - the member's own device
 * choice first (the theme cookie), the admin's site default behind
 * it, and empty css meaning follow the device. */
export const load: LayoutServerLoad = async ({ platform, locals, cookies }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	const theme = cookies.get('theme') || settings.theme;
	return {
		siteName: settings.siteName,
		welcomeText: settings.welcomeText,
		theme,
		themeCss: themeCss(theme),
		isAdmin: locals.member?.isAdmin ?? false
	};
};
