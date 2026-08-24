import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

/** Admins only; everyone else is quietly sent home. */
export const load: LayoutServerLoad = async ({ locals, platform }) => {
	if (!locals.member?.isAdmin) redirect(303, '/home');
	const pending = await getDb(platform!.env.DB)
		.select({ id: table.members.id })
		.from(table.members)
		.where(eq(table.members.status, 'pending'));
	return { pendingCount: pending.length };
};
