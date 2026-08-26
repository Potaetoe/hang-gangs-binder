import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { identityOf, setDisplayName, type Secrets } from '$lib/server/auth';
import { PALETTES } from '$lib/server/settings';
import { parseSocialsForm, setSocials, socialsOf, type SocialLinks } from '$lib/server/socials';

/** The member's own settings (owner ruling 2026-08-24): device-level
 * choices, stored in cookies like the units toggle - the admin's
 * site settings stay the default for anyone who has not chosen. One
 * tap saves; there is no Save button. */
export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const db = getDb(platform!.env.DB);
	// Telegram-only members have no password to change (owner,
	// 2026-08-24) - the card only shows where the door exists.
	const passwordLogin = (
		await db
			.select({ kind: table.logins.kind })
			.from(table.logins)
			.where(
				and(eq(table.logins.memberId, locals.member.memberId), eq(table.logins.kind, 'password'))
			)
	)[0];
	const identity = await identityOf(
		db,
		platform!.env as unknown as Secrets,
		locals.member.memberId
	);
	const mySocials: SocialLinks =
		(await socialsOf(db, platform!.env as unknown as Secrets, locals.member.memberId)) ?? {};
	return {
		myName: identity.displayName || identity.handle || identity.username || '',
		myTheme: cookies.get('theme') ?? '',
		myUnits: cookies.get('units') === 'metric' ? 'metric' : 'imperial',
		mySocials,
		themeChoices: ['', ...Object.keys(PALETTES)],
		hasPasswordDoor: Boolean(passwordLogin)
	};
};

const COOKIE = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: true,
	maxAge: 400 * 86_400
} as const;

export const actions: Actions = {
	name: async ({ request, locals, platform }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		await setDisplayName(
			getDb(platform!.env.DB),
			platform!.env as unknown as Secrets,
			locals.member.memberId,
			String(form.get('display_name') ?? '')
		);
		redirect(303, '/settings');
	},

	theme: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const theme = String((await request.formData()).get('theme') ?? '');
		if (theme && theme in PALETTES) {
			cookies.set('theme', theme, COOKIE);
		} else {
			cookies.delete('theme', { path: '/' });
		}
		redirect(303, '/settings');
	},

	socials: async ({ request, locals, platform }) => {
		if (!locals.member) redirect(303, '/');
		const parsed = parseSocialsForm(await request.formData());
		if (!parsed.ok) return fail(400, { socialsProblems: parsed.problems });
		await setSocials(
			getDb(platform!.env.DB),
			platform!.env as unknown as Secrets,
			locals.member.memberId,
			parsed.links
		);
		return { socialsSaved: true };
	},

	/** Desktop mode (owner ruling 2026-08-26): an admin calls the Admin
	 * door onto the phone rail for one sitting. The cookie carries no
	 * age, so closing the browser puts the phone view back on its own. */
	desk: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const open = (await request.formData()).get('door') === 'open';
		if (open && locals.member.isAdmin) {
			cookies.set('admin_door', 'here', {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: true
			});
		} else {
			cookies.delete('admin_door', { path: '/' });
		}
		redirect(303, '/settings');
	},

	units: async ({ request, locals, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		// The DEFAULT (owner ruling 2026-08-26). The page toggles carry a
		// one-view ?u= and store nothing. The delete sweeps the view
		// cookie one interim build wrote - members who never saw that
		// build have nothing to sweep.
		cookies.set('units', form.get('units') === 'metric' ? 'metric' : 'imperial', COOKIE);
		cookies.delete('units_view', { path: '/' });
		redirect(303, '/settings');
	}
};
