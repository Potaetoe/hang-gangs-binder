// The departed cleanup, a full purge, proven to the row. The worst failure this app could have is
// a purge that only LOOKED complete - so after the admin sweeps, the
// test counts what is left, table by table, and demands zero.
import { expect, test } from '@playwright/test';
import { fillStable, register, signIn, entryRow } from './helpers';

test('a purged member leaves nothing behind but the unlinkable log line', async ({
	page,
	browser
}) => {
	const stamp = Date.now();
	const boss = `sweeper${stamp}`;
	const departed = `goner${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, departed);
	expect((await page.request.post(`/test/approve?username=${departed}`)).ok()).toBeTruthy();

	// An event for the member to be interested in, made in the admin's
	// own context so the member's session stays the only one on `page`.
	const setup = await browser.newContext();
	const setupPage = await setup.newPage();
	await signIn(setupPage, boss);
	await setupPage.goto('/admin/events');
	await fillStable(setupPage, /what is happening/i, `Farewell ${stamp}`);
	await fillStable(setupPage, 'The day', '2034-02-14');
	await setupPage.getByRole('button', { name: 'Add the event' }).click();
	// The add lands on the new event's own admin page.
	await expect(setupPage.getByRole('heading', { name: `Farewell ${stamp}` })).toBeVisible();
	await setup.close();

	// The member leaves tracks in every table a member can touch:
	// entries and their values, a correction (the audit trail), a
	// socials row, an RSVP, the sealed directory row, a login, a live
	// session.
	await signIn(page, departed);
	await fillStable(page, 'Weight', '200');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['200 lb'])).toBeVisible();
	await fillStable(page, 'Weight', '205');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await entryRow(page, ['205 lb']).getByRole('link', { name: 'Edit' }).click();
	await fillStable(page, 'Weight', '204');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(entryRow(page, ['204 lb'])).toBeVisible();
	await page.goto('/settings');
	await fillStable(page, 'X handle', `goner${stamp}`);
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.goto('/home?cal=2034-02');
	const farewell = page.locator('article.event').filter({ hasText: `Farewell ${stamp}` });
	await farewell.getByRole('button', { name: "I'm interested" }).click();
	await expect(farewell.locator('.rsvp-count')).toHaveText('1 interested · including you');

	// The opaque id, captured while it can still be looked up - after
	// the purge there is no path from a name to it, which is the point.
	const found = await page.request.get(`/test/member-id?username=${departed}`);
	expect(found.ok()).toBeTruthy();
	const { id } = (await found.json()) as { id: string };

	// The admin works in a browser context of their OWN, so the member
	// never signs out - a live session row must die with the purge,
	// not with a polite sign-out first.
	const admin = await browser.newContext();
	const adminPage = await admin.newPage();
	await signIn(adminPage, boss);
	await adminPage.goto('/admin/members');
	await adminPage
		.locator('.admin-table tbody tr')
		.filter({ hasText: departed })
		.getByRole('link', { name: 'Open' })
		.click();
	await adminPage.getByText('Remove this member for good').click();
	await adminPage.getByRole('button', { name: 'Yes, remove everything' }).click();

	// Gone from the roster.
	await adminPage.goto('/admin/members');
	await expect(
		adminPage.locator('.admin-table tbody tr').filter({ hasText: departed })
	).toHaveCount(0);

	// Gone from every table - zero rows, counted, not assumed.
	const swept = await adminPage.request.get(`/test/purged?id=${id}`);
	expect(swept.ok()).toBeTruthy();
	const counts = (await swept.json()) as Record<string, number>;
	expect(counts).toEqual({
		members: 0,
		logins: 0,
		directory: 0,
		socials: 0,
		sessions: 0,
		entries: 0,
		orphanValues: 0,
		memberAudit: 0,
		rsvps: 0
	});

	// The member's own next click meets a signed-out site: their
	// session row is gone, not just their data.
	await page.goto('/home');
	await expect(page.getByText('With a password')).toBeVisible();

	// The log remembers the ACT, tied to nobody.
	await adminPage.goto('/admin/log');
	await expect(adminPage.getByText('removed a departed member').first()).toBeVisible();
	await expect(adminPage.getByText('2 entries erased').first()).toBeVisible();
	await admin.close();
});
