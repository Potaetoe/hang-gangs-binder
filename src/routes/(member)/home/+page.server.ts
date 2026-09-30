import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { identityOf, nameOf } from '$lib/server/identity';
import { computeCalculated, loadFields } from '$lib/server/fields';
import {
	carryForward,
	createEntry,
	echoEntryForm,
	entryTable,
	formFieldViews,
	historyFor,
	memberHistory,
	memberTrends,
	parseEntryForm
} from '$lib/server/entries';
import {
	calendarCard,
	eventById,
	monthOf,
	rsvpOpen,
	setRsvp,
	validMonth
} from '$lib/server/events';
import { loadSettings, siteDay, trendSet } from '$lib/server/settings';
import { hasSocials } from '$lib/server/socials';
import { pendingCount } from '$lib/server/admin';
import { dayIn } from '$lib/server/days';
import { formUnits, memberUnits } from '$lib/server/units';

/** The entries card scrolls inside itself, so a page can be deep. */
const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, platform, url, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const { memberId, isAdmin } = locals.member!;
	const units = memberUnits(cookies, url);
	const settings = await loadSettings(db);
	const today = dayIn(settings.timezone);
	const fields = await loadFields(db);

	const cal = url.searchParams.get('cal') ?? '';
	const month = validMonth(cal) ? cal : monthOf(today);
	const page = Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);
	const { entries, hasOlder } = await memberHistory(db, memberId, page, PAGE_SIZE);
	const chosen = trendSet(settings);

	return {
		name: nameOf(await identityOf(db, env, memberId)) || 'member',
		isAdmin,
		// Admins hear about waiting registrations the moment they land.
		pendingCount: isAdmin ? await pendingCount(db) : 0,
		// Shows until the member lists a link or waves it away on this device.
		socialsNudge: cookies.get('socials_nudge') !== 'off' && !(await hasSocials(db, memberId)),
		units,
		formFields: formFieldViews(fields, (await historyFor(db, memberId)).prev, units),
		trends: await memberTrends(
			db,
			fields.filter((f) => chosen.has(f.id)),
			memberId,
			units
		),
		...(await calendarCard(db, memberId, month, Number(url.searchParams.get('ev')), today)),
		month,
		entryTable: entryTable(fields, entries, units),
		page,
		hasOlder
	};
};

export const actions: Actions = {
	entry: async ({ request, locals, platform, cookies }) => {
		const db = getDb(platform!.env.DB);
		const { memberId } = locals.member!;
		const form = await request.formData();
		const units = formUnits(form, cookies);
		const fields = await loadFields(db);
		const { values, problems } = parseEntryForm(fields, form, units);
		if (problems.length) return fail(400, { problems, raw: echoEntryForm(form) });

		const history = await historyFor(db, memberId);
		carryForward(fields, values, history.prev);
		if (!Object.keys(values).length) {
			return fail(400, {
				problems: ['Nothing to save yet - fill in at least one field.'],
				raw: echoEntryForm(form)
			});
		}
		computeCalculated(fields, values, history);
		await createEntry(db, memberId, await siteDay(db), values);
		// The confirmation shows in the units just typed in.
		redirect(303, `/home?u=${units}`);
	},

	rsvp: async ({ request, locals, platform }) => {
		const db = getDb(platform!.env.DB);
		const form = await request.formData();
		const event = await eventById(db, String(form.get('event') ?? ''));
		if (!event) return fail(404, { rsvpProblem: 'That event is gone.' });
		// Closed means closed, even for a page loaded while it was open.
		if (!rsvpOpen(event, await siteDay(db))) {
			return fail(400, { rsvpProblem: `RSVPs for ${event.title} are closed.` });
		}
		await setRsvp(db, event.id, locals.member!.memberId, form.get('on') === '1');
		// Back to the same card. The query is rebuilt from checked numbers,
		// never echoed, so it cannot become an open redirect.
		const ev = Math.max(1, Math.floor(Number(form.get('ev'))) || 1);
		const page = Math.max(1, Math.floor(Number(form.get('page'))) || 1);
		let query = `?cal=${monthOf(event.date)}`;
		if (ev > 1) query += `&ev=${ev}`;
		if (page > 1) query += `&page=${page}`;
		redirect(303, `/home${query}#ev-${event.id}`);
	},

	nudgeoff: async ({ cookies }) => {
		cookies.set('socials_nudge', 'off', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 400 * 86_400
		});
		redirect(303, '/home');
	}
};
