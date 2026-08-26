// The departed cleanup (DESIGN.md "Admin surface"; owner ruling: full
// purge), proven to the row. The worst failure this app could have is
// a purge that only LOOKED complete - so after the admin sweeps, the
// test counts what is left, table by table, and demands zero.
import { expect, test, type Page } from '@playwright/test';

async function fillStable(page: Page, label: string | RegExp, value: string) {
	await expect(async () => {
		await page.getByLabel(label).fill(value);
		expect(await page.getByLabel(label).inputValue()).toBe(value);
	}).toPass({ timeout: 10_000 });
}

async function openPasswordFlap(page: Page) {
	await expect(async () => {
		await page.getByText('With a password').click();
		await expect(page.getByLabel('Username')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 10_000 });
}

async function register(page: Page, username: string) {
	await page.goto('/register');
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: /ask for the account/i }).click();
	await expect(page.getByText(/an admin has to approve/i)).toBeVisible();
}

async function signIn(page: Page, username: string) {
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
}

function entryRow(page: Page, texts: string[]) {
	let row = page.locator('.entries-table tbody tr');
	for (const text of texts) row = row.filter({ hasText: text });
	return row;
}

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

	// The member leaves tracks in every table a member can touch:
	// entries and their values, a correction (the audit trail), a
	// socials row, the sealed directory row, a login, a live session.
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
		memberAudit: 0
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
