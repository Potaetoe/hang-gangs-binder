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

	// The waiting banner carries the admin straight to approvals. (The
	// socials nudge is a banner too - a.banner picks the approvals one.)
	await expect(page.locator('a.banner')).toContainText('waiting to be approved');
	await page.locator('a.banner').click();
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
	await expect(page.locator('.entries-table tbody tr').first()).toBeVisible();
	await signOut(page);

	// The admin opens the member and sees the number.
	await signIn(page, boss);
	await page.goto('/admin/members');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: pat })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.getByText('200 lb').first()).toBeVisible();

	// A temporary passphrase, typed by the admin.
	await page.getByText('Reset password', { exact: true }).click();
	await fillStable(page, /temporary passphrase/i, 'temp-pass-12345');
	await page.getByRole('button', { name: 'Set passphrase' }).click();
	await expect(page.getByText(/hand it over out of band/i)).toBeVisible();
	await signOut(page);

	// The old password is dead; the temporary one leads to a wall.
	await signIn(page, pat);
	await expect(page.getByText(/did not match/i)).toBeVisible();
	await signIn(page, pat, 'temp-pass-12345');
	await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();
	await page.goto('/home');
	await expect(page.getByRole('heading', { name: 'New password' })).toBeVisible();

	// Picking a real password opens the site back up.
	await fillStable(page, /temporary passphrase/i, 'temp-pass-12345');
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
		.locator('.admin-table tbody tr')
		.filter({ hasText: solo })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByRole('button', { name: 'Remove admin' }).click();
	await expect(page.getByText(/cannot remove your own/i)).toBeVisible();

	// But you can raise someone else.
	await page.goto('/admin/members');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: riser })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByRole('button', { name: 'Make admin' }).click();
	await expect(page.locator('.badge').filter({ hasText: 'admin' })).toBeVisible();
});

test('a removed admin loses the keys on the next click', async ({ browser }) => {
	const stamp = Date.now();
	const senior = `senior${stamp}`;
	const deputy = `deputy${stamp}`;
	// Two browsers, the way it happens in life: the deputy is signed in
	// somewhere when the senior takes the role away.
	const seniorContext = await browser.newContext();
	const deputyContext = await browser.newContext();
	const seniorPage = await seniorContext.newPage();
	const deputyPage = await deputyContext.newPage();

	await register(seniorPage, senior);
	await makeAdmin(seniorPage, senior);
	await register(deputyPage, deputy);
	await makeAdmin(deputyPage, deputy);
	await signIn(seniorPage, senior);
	await signIn(deputyPage, deputy);

	// The deputy's session opens the admin surface fine...
	await deputyPage.goto('/admin/members');
	await expect(deputyPage.locator('.admin-table')).toBeVisible();

	// ...until the senior removes the role.
	await seniorPage.goto('/admin/members');
	await seniorPage
		.locator('.admin-table tbody tr')
		.filter({ hasText: deputy })
		.getByRole('link', { name: 'Open' })
		.click();
	await seniorPage.getByRole('button', { name: 'Remove admin' }).click();
	await expect(seniorPage.getByRole('button', { name: 'Make admin' })).toBeVisible();

	// The deputy's SAME session is shut out on the very next click - no
	// new sign-in needed for the change to hold (fix pass 2026-08-25).
	await deputyPage.goto('/admin/members');
	await expect(deputyPage).toHaveURL(/\/home$/);
	await expect(deputyPage.locator('.rail').getByRole('link', { name: 'Admin' })).not.toBeVisible();

	await seniorContext.close();
	await deputyContext.close();
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
	await page.getByRole('button', { name: 'Meadow' }).click();
	await expect(async () => {
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(242, 239, 233)');
	}).toPass({ timeout: 5000 });

	// Back to the site default.
	await page.getByRole('button', { name: 'Site default' }).click();
});

test('the admin curates which fields carry trend lines', async ({ page }) => {
	const stamp = Date.now();
	const boss = `curator${stamp}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await signIn(page, boss);

	// Two entries give height, weight and BMI their points.
	await fillStable(page, /height, feet/i, '5');
	await fillStable(page, /height, inches/i, '10');
	await fillStable(page, 'Weight', '180');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await fillStable(page, 'Weight', '185');
	await page.getByRole('button', { name: 'Save entry' }).click();

	// Out of the box: Weight and BMI trend; adult height does not
	// (owner ruling 2026-08-26).
	await expect(page.locator('.trend').filter({ hasText: 'Weight' })).toBeVisible();
	await expect(page.locator('.trend').filter({ hasText: 'BMI' })).toBeVisible();
	await expect(page.locator('.trend').filter({ hasText: 'Height' })).not.toBeVisible();

	// And the trends close the page: below the entries.
	const trendsBox = await page.locator('.fold-trends').boundingBox();
	const entriesBox = await page.locator('.fold-entries').boundingBox();
	expect(trendsBox!.y).toBeGreaterThan(entriesBox!.y);

	// Height keeps everything but the trend line on its focused page.
	await page.goto('/charts');
	await page.locator('.tile').filter({ hasText: 'Height' }).click();
	await expect(page.getByText('Where everyone sits')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Trend', exact: true })).not.toBeVisible();

	// The admin flips the set: Height on, BMI off. The cards follow.
	await page.goto('/admin/settings');
	await page.getByRole('checkbox', { name: 'Height' }).check();
	await page.getByRole('checkbox', { name: 'BMI' }).uncheck();
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.goto('/home');
	await expect(page.locator('.trend').filter({ hasText: 'Height' })).toBeVisible();
	await expect(page.locator('.trend').filter({ hasText: 'BMI' })).not.toBeVisible();
	await page.goto('/admin/log');
	await expect(page.getByText('changed the trend graphs').first()).toBeVisible();
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

test('the group links come from admin settings, and the Socials page carries them', async ({
	page
}) => {
	// Moved here from socials.e2e.ts (2026-08-26): saving admin
	// settings writes the WHOLE settings form, so a save in another
	// file running in parallel wiped the group links this test had just
	// set - the same shared-singleton care as the site name above.
	// Tests in one file run in order; every settings writer lives here.
	const boss = `linkboss${Date.now()}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await signIn(page, boss);
	await page.goto('/admin/settings');
	await fillStable(page, 'Group link 1 name', 'The group chat');
	await fillStable(page, 'Group link 1 address', 'https://t.me/example');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.getByRole('link', { name: 'The group chat' })).toBeVisible();
});

test('an admin calls the Admin door onto the phone rail for one sitting', async ({ page }) => {
	const boss = `deskboss${Date.now()}`;
	await register(page, boss);
	await makeAdmin(page, boss);
	await signIn(page, boss);
	await expect(page.locator('.rail').getByRole('link', { name: 'Admin' })).toBeVisible();

	// The phone rail runs four stops - no Admin - but Settings offers
	// Mobile Admin Mode to an admin (owner ruling 2026-08-26).
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto('/settings');
	await expect(page.locator('.rail').getByRole('link', { name: 'Admin' })).not.toBeVisible();
	await page.getByRole('button', { name: 'Turn on Mobile Admin Mode' }).click();

	// The door is on the rail now, and it opens.
	await page.locator('.rail').getByRole('link', { name: 'Admin' }).click();
	await expect(page).toHaveURL(/\/admin/);

	// The desktop width already carries the door, so the section hides.
	await page.goto('/settings');
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.getByRole('heading', { name: 'Mobile Admin Mode' })).not.toBeVisible();
	await page.setViewportSize({ width: 375, height: 812 });

	// Shut it by hand; closing the browser would have done the same.
	await page.getByRole('button', { name: 'Turn off Mobile Admin Mode' }).click();
	await expect(page.locator('.rail').getByRole('link', { name: 'Admin' })).not.toBeVisible();
});
