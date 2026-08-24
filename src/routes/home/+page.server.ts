import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession, identityOf, setDisplayName, type Secrets } from '$lib/server/auth';
import {
	computeBmi,
	createEntry,
	formatDate,
	formatValue,
	formFieldViews,
	latestValues,
	loadFields,
	memberHistory,
	memberTrends,
	parseEntryForm,
	sparklinePoints,
	today,
	type Units
} from '$lib/server/stats';
import type { HistoryRow, TrendView } from '$lib/views';

const PAGE_SIZE = 10;

const unitsOf = (cookie: string | undefined): Units =>
	cookie === 'metric' ? 'metric' : 'imperial';

/** Everything a submitted form's fields said, echoed back on failure
 * so a typo never costs the rest of what was typed. */
const rawEcho = (form: FormData): Record<string, string> =>
	Object.fromEntries(
		[...form.entries()].filter(
			(pair): pair is [string, string] => pair[0].startsWith('f_') && typeof pair[1] === 'string'
		)
	);

export const load: PageServerLoad = async ({ locals, platform, url, cookies }) => {
	if (!locals.member) redirect(303, '/');
	const env = platform!.env;
	const db = getDb(env.DB);
	const memberId = locals.member.memberId;
	const units = unitsOf(cookies.get('units'));

	const identity = await identityOf(db, env as unknown as Secrets, memberId);
	const fields = await loadFields(db);
	const latest = await latestValues(db, memberId);

	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const { entries, hasOlder } = await memberHistory(db, memberId, page, PAGE_SIZE);
	const history: HistoryRow[] = entries.map(({ entry, values }) => ({
		id: entry.id,
		dateLabel: formatDate(entry.date),
		summary: fields
			.map((field) => {
				const value = values.find((v) => v.fieldId === field.id);
				return value ? formatValue(field, value, units) : '';
			})
			.filter(Boolean)
			.join(' · ')
	}));

	const trends: TrendView[] = (await memberTrends(db, fields, memberId, units)).map((t) => ({
		name: t.field.name,
		poly: sparklinePoints(t.points),
		latest: t.latest
	}));

	return {
		name: identity.displayName || identity.handle || identity.username || 'member',
		isAdmin: locals.member.isAdmin,
		units,
		todayLabel: formatDate(today(env.TIMEZONE)),
		formFields: formFieldViews(fields, latest, units),
		trends,
		history,
		page,
		hasOlder
	};
};

export const actions: Actions = {
	entry: async ({ request, locals, platform, cookies }) => {
		if (!locals.member) redirect(303, '/');
		const env = platform!.env;
		const db = getDb(env.DB);
		const form = await request.formData();
		const units = unitsOf(cookies.get('units'));

		const fields = await loadFields(db);
		const { values, problems } = parseEntryForm(fields, form, units);
		if (!problems.length && !Object.keys(values).length) {
			problems.push('Nothing to save yet - fill in at least one field.');
		}
		if (problems.length) return fail(400, { problems, raw: rawEcho(form) });

		computeBmi(fields, values);
		await createEntry(db, locals.member.memberId, today(env.TIMEZONE), values);
		redirect(303, '/home');
	},

	name: async ({ request, locals, platform }) => {
		if (!locals.member) redirect(303, '/');
		const env = platform!.env;
		const form = await request.formData();
		await setDisplayName(
			getDb(env.DB),
			env as unknown as Secrets,
			locals.member.memberId,
			String(form.get('display_name') ?? '')
		);
		redirect(303, '/home');
	},

	units: async ({ request, cookies, locals }) => {
		if (!locals.member) redirect(303, '/');
		const form = await request.formData();
		const choice = form.get('units') === 'metric' ? 'metric' : 'imperial';
		cookies.set('units', choice, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 400 * 86_400
		});
		redirect(303, '/home');
	},

	signout: async ({ cookies, platform }) => {
		const env = platform!.env;
		await destroySession(getDb(env.DB), cookies.get('session'));
		cookies.delete('session', { path: '/' });
		redirect(303, '/');
	}
};
