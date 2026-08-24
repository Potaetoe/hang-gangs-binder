import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadSettings, themeCss } from '$lib/server/settings';

/** Every page carries the site's settings: the name on the brand, the
 * door's welcome line, and the palette an admin pinned (empty css =
 * follow the device). */
export const load: LayoutServerLoad = async ({ platform, locals }) => {
	const settings = await loadSettings(getDb(platform!.env.DB));
	return {
		siteName: settings.siteName,
		welcomeText: settings.welcomeText,
		theme: settings.theme,
		themeCss: themeCss(settings.theme),
		isAdmin: locals.member?.isAdmin ?? false
	};
};
