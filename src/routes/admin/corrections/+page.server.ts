import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { readCorrections } from '$lib/server/admin';
import type { Secrets } from '$lib/server/auth';
import { formatValue, loadFields, memberUnits, type EntryValue } from '$lib/server/stats';

export const load: PageServerLoad = async ({ platform, cookies }) => {
	const env = platform!.env;
	const db = getDb(env.DB);
	const units = memberUnits(cookies);
	const fields = await loadFields(db);
	const lines = await readCorrections(db, env as unknown as Secrets);
	return {
		lines: lines.map((line) => {
			let before: string;
			try {
				const parsed = JSON.parse(line.before) as Record<string, Partial<EntryValue>>;
				before = fields
					.map((field) => {
						const v = parsed[field.id];
						return v ? formatValue(field, v as EntryValue, units) : '';
					})
					.filter(Boolean)
					.join(' · ');
			} catch {
				before = '';
			}
			return { ...line, before };
		})
	};
};
