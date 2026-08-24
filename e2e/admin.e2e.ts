// The admin surface (build order step 4, owner rulings 2026-08-24):
// approvals, the roster, roles, the temporary passphrase and its
// wall, settings, and the change log - walked as the admin and as the
// member on the other side.
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

async function register(page: Page, username: string, password = 'a-decent-password') {
	await page.goto('/register');
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', password);
	await page.getByRole('button', { name: /ask for the account/i }).click();
	await expect(page.getByText(/an admin has to approve/i)).toBeVisible();
}

async function signIn(page: Page, username: string, password = 'a-decent-password') {
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
	await page.goto('/home');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
}

async function makeAdmin(page: Page, username: string) {
	const done = await page.request.post(`/test/admin?username=${username}`);
	expect(done.ok()).toBeTruthy();
}

test('the admin approves, denies, and the log remembers', async ({ page }) => {
	const stamp = Date.now();
	// Everyone registers while signed out - a signed-in member is
	// (rightly) bounced off the register page.
	const boss = `boss${stamp}`;
	const asker = `asker${stamp}`;
	const denied = `denied${stamp}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await register(page, asker);
	await register(page, denied);

	await signIn(page, boss);
	await expect(page.locator('.rail').getByRole('link', { name: 'Admin' })).toBeVisible();

	// The admin sees who is asking and lets one in.
	await page.locator('.rail').getByRole('link', { name: 'Admin' }).click();
	await page.locator('.fieldlist').getByRole('link', { name: 'Approvals' }).click();
	const askerRow = page.locator('.history li').filter({ hasText: asker });
	await expect(askerRow).toBeVisible();
	await askerRow.getByRole('button', { name: 'Approve' }).click();
	await expect(page.locator('.history li').filter({ hasText: asker })).not.toBeVisible();

	// Deny deletes the registration; the username frees up again.
	await page
		.locator('.history li')
		.filter({ hasText: denied })
		.getByRole('button', { name: 'Deny' })
		.click();
	await expect(page.locator('.history li').filter({ hasText: denied })).not.toBeVisible();

	// Both actions left their lines.
	await page.goto('/admin/log');
	await expect(page.getByText(/approved the account/).first()).toBeVisible();
	await expect(page.getByText(/denied a registration/).first()).toBeVisible();

	// The freed username registers again, from outside.
	await signOut(page);
	await register(page, denied);
});

test('the admin sees everything, and the passphrase walls the member off', async ({ page }) => {
	const stamp = Date.now();
	const boss = `chief${stamp}`;
	const pat = `pat${stamp}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await register(page, pat);
	const approved = await page.request.post(`/test/approve?username=${pat}`);
	expect(approved.ok()).toBeTruthy();

	// The member logs a number.
	await signIn(page, pat);
	await fillStable(page, 'Weight', '200');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entry-summary').first()).toBeVisible();
	await signOut(page);

	// The admin opens the member and sees the number.
	await signIn(page, boss);
	await page.goto('/admin/members');
	await page
		.locator('.history li')
		.filter({ hasText: pat })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.getByText('200 lb').first()).toBeVisible();

	// A temporary passphrase, typed by the admin.
	await page.getByText('Set a temporary passphrase').click();
	await fillStable(page, /temporary passphrase/i, 'temp-pass-123');
	await page.getByRole('button', { name: 'Set passphrase' }).click();
	await expect(page.getByText(/hand it over out of band/i)).toBeVisible();
	await signOut(page);

	// The old password is dead; the temporary one leads to a wall.
	await signIn(page, pat);
	await expect(page.getByText(/did not match/i)).toBeVisible();
	await signIn(page, pat, 'temp-pass-123');
	await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();
	await page.goto('/home');
	await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();

	// Picking a real password opens the site back up.
	await fillStable(page, /temporary passphrase/i, 'temp-pass-123');
	await fillStable(page, 'New password', 'my-own-password-1');
	await page.getByRole('button', { name: 'Save password' }).click();
	await expect(page.getByRole('heading', { name: new RegExp(`hello, ${pat}`, 'i') })).toBeVisible();
	await signOut(page);
	await signIn(page, pat, 'my-own-password-1');
	await expect(page.getByRole('heading', { name: new RegExp(`hello, ${pat}`, 'i') })).toBeVisible();
});

test('roles guard themselves', async ({ page }) => {
	const stamp = Date.now();
	const solo = `solo${stamp}`;
	const riser = `riser${stamp}`;
	await register(page, solo);
	await makeAdmin(page, solo);
	await register(page, riser);
	const approved = await page.request.post(`/test/approve?username=${riser}`);
	expect(approved.ok()).toBeTruthy();
	await signIn(page, solo);

	// You cannot take your own admin role away.
	await page.goto('/admin/members');
	await page
		.locator('.history li')
		.filter({ hasText: solo })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByRole('button', { name: 'Remove admin' }).click();
	await expect(page.getByText(/cannot remove your own/i)).toBeVisible();

	// But you can raise someone else.
	await page.goto('/admin/members');
	await page
		.locator('.history li')
		.filter({ hasText: riser })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByRole('button', { name: 'Make admin' }).click();
	await expect(page.locator('.badge').filter({ hasText: 'admin' })).toBeVisible();
});

test('a member paints their own device', async ({ page }) => {
	const stamp = Date.now();
	const painter = `painter${stamp}`;
	await register(page, painter);
	const approved = await page.request.post(`/test/approve?username=${painter}`);
	expect(approved.ok()).toBeTruthy();
	await signIn(page, painter);

	// The rail carries every member to their settings.
	await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
	await page.getByLabel('Theme').selectOption('meadow');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(async () => {
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(242, 239, 233)');
	}).toPass({ timeout: 5000 });

	// Back to the site default.
	await page.getByLabel('Theme').selectOption('');
	await page.getByRole('button', { name: 'Save' }).click();
});

test('settings shape the site', async ({ page }) => {
	const stamp = Date.now();
	const boss = `styler${stamp}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await signIn(page, boss);

	// Welcome text and palette change... (site name is the same
	// mechanism, left alone so parallel tests keep their door.)
	await page.goto('/admin/settings');
	await fillStable(page, /welcome text/i, 'The circle welcomes you.');
	await page.getByLabel('Theme').selectOption('plum');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await signOut(page);

	// ...and the door wears both.
	await expect(page.getByText('The circle welcomes you.')).toBeVisible();
	await expect(async () => {
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(36, 27, 33)');
	}).toPass({ timeout: 5000 });

	// The change log kept the lines; then everything goes back.
	await signIn(page, boss);
	await page.goto('/admin/log');
	await expect(page.getByText(/changed the theme/).first()).toBeVisible();
	await page.goto('/admin/settings');
	await fillStable(
		page,
		/welcome text/i,
		'Sign in once — then it is your page to fill in, and everyone’s numbers to read.'
	);
	await page.getByLabel('Theme').selectOption('auto');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
});
