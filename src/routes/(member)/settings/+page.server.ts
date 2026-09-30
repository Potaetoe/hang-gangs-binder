import { fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { identityOf, nameOf, setDisplayName } from '$lib/server/identity';
import { PALETTES } from '$lib/server/settings';
import { parseSocialsForm, setSocials, socialsOf } from '$lib/server/socials';

/**
 * A member's own choices. Theme and units are device cookies, so the
 * admin's site settings stay the default for anyone who has not chosen.
 * One tap saves; there is no Save button.
 */
export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const { memberId } = locals.member!;
	// Telegram-only members have no password to change.
	const [passwordLogin] = await db
		.select({ kind: table.logins.kind })
		.from(table.logins)
		.where(and(eq(table.logins.memberId, memberId), eq(table.logins.kind, 'password')));
	return {
		myName: nameOf(await identityOf(db, env, memberId)),
		myTheme: cookies.get('theme') ?? '',
		myUnits: cookies.get('units') === 'metric' ? 'metric' : 'imperial',
		mySocials: (await socialsOf(db, env, memberId)) ?? {},
		themeChoices: ['', ...Object.keys(PALETTES)],
		hasPasswordDoor: Boolean(passwordLogin)
	};
};

const DEVICE_COOKIE = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: true,
	maxAge: 400 * 86_400
} as const;

export const actions: Actions = {
	name: async ({ request, locals, platform }) => {
		const env = platform!.env;
		const form = await request.formData();
		await setDisplayName(
			getDb(env.DB),
			env,
			locals.member!.memberId,
			String(form.get('display_name') ?? '')
		);
		redirect(303, '/settings');
	},

	theme: async ({ request, cookies }) => {
		const theme = String((await request.formData()).get('theme') ?? '');
		if (Object.hasOwn(PALETTES, theme)) cookies.set('theme', theme, DEVICE_COOKIE);
		else cookies.delete('theme', { path: '/' });
		redirect(303, '/settings');
	},

	socials: async ({ request, locals, platform }) => {
		const env = platform!.env;
		const parsed = parseSocialsForm(await request.formData());
		if (!parsed.ok) return fail(400, { socialsProblems: parsed.problems });
		await setSocials(getDb(env.DB), env, locals.member!.memberId, parsed.links);
		return { socialsSaved: true };
	},

	/** Mobile Admin Mode. The cookie has no age, so closing the browser
	 * puts the phone rail back on its own. */
	desk: async ({ request, locals, cookies }) => {
		const open = (await request.formData()).get('door') === 'open';
		if (open && locals.member!.isAdmin) {
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

	/** The default units. A page's own toggle stores nothing. */
	units: async ({ request, cookies }) => {
		const form = await request.formData();
		cookies.set('units', form.get('units') === 'metric' ? 'metric' : 'imperial', DEVICE_COOKIE);
		redirect(303, '/settings');
	}
};
