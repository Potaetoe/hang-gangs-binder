// The socials page (DESIGN.md feature 6, owner rulings 2026-08-26),
// walked as the people who use it: a member lists where they are, the
// roster tells the gang, the nudges chase the quiet ones, and the
// admin holds the moderation lever.
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

async function signOut(page: Page) {
	await page.goto('/home');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
}

test('a member lists their socials and the roster carries them', async ({ page }) => {
	const stamp = Date.now();
	const linked = `linked${stamp}`;
	const quiet = `quiet${stamp}`;
	await register(page, linked);
	expect((await page.request.post(`/test/approve?username=${linked}`)).ok()).toBeTruthy();
	await register(page, quiet);
	expect((await page.request.post(`/test/approve?username=${quiet}`)).ok()).toBeTruthy();

	// No links yet: Home nudges, and so does the Socials page.
	await signIn(page, linked);
	await expect(page.getByText(/add your socials/i)).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.getByText(/add your socials/i)).toBeVisible();
	await expect(page.getByText(/nobody has listed their socials yet/i)).toBeVisible();

	// The nudge banner leads to the Settings form.
	await page.getByRole('link', { name: /add your socials/i }).click();
	await fillStable(page, 'X handle', `@gainer${stamp}`);
	await fillStable(page, 'FetLife profile link', 'https://fetlife.com/users/1234567');
	await fillStable(page, /something else/i, 'Bluesky');
	await fillStable(page, /and its link/i, `https://bsky.app/profile/gainer${stamp}`);
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	// The roster shows the row: the handle became its URL, the pasted
	// links carried, and the nudges are gone.
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.getByText(/add your socials/i)).not.toBeVisible();
	const row = page.locator('.socials-roster li').filter({ hasText: linked });
	await expect(row).toBeVisible();
	expect(await row.locator('.social-x').getAttribute('href')).toBe(`https://x.com/gainer${stamp}`);
	expect(await row.locator('.social-fetlife').getAttribute('href')).toBe(
		'https://fetlife.com/users/1234567'
	);
	await expect(row.locator('.social-other')).toHaveAttribute('title', 'Bluesky');
	await page.goto('/home');
	await expect(page.getByText(/add your socials/i)).not.toBeVisible();
	await signOut(page);

	// The quiet member sees the roster and their own nudge; the X waves
	// it off this device, and it stays waved.
	await signIn(page, quiet);
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.locator('.socials-roster li').filter({ hasText: linked })).toBeVisible();
	await expect(page.locator('.socials-roster li').filter({ hasText: quiet })).not.toBeVisible();
	await page.goto('/home');
	await expect(page.getByText(/add your socials/i)).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByText(/add your socials/i)).not.toBeVisible();
	await page.reload();
	await expect(page.getByText(/add your socials/i)).not.toBeVisible();
});

test('bad links are refused all at once, and clearing leaves the roster', async ({ page }) => {
	const stamp = Date.now();
	const fumbler = `fumbler${stamp}`;
	await register(page, fumbler);
	expect((await page.request.post(`/test/approve?username=${fumbler}`)).ok()).toBeTruthy();

	await signIn(page, fumbler);
	await page.goto('/settings');
	await fillStable(page, 'X handle', 'not a handle!!');
	await fillStable(page, 'Feabie profile link', 'https://not-feabie.example/me');
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText(/does not read as a handle/i)).toBeVisible();
	await expect(page.getByText(/whole https link to your feabie.com profile/i)).toBeVisible();

	// A good save, then a full clear: the row leaves the roster.
	await fillStable(page, 'X handle', 'redeemed');
	await fillStable(page, 'Feabie profile link', 'https://www.feabie.com/redeemed');
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await fillStable(page, 'X handle', '');
	await fillStable(page, 'Feabie profile link', '');
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.locator('.socials-roster li').filter({ hasText: fumbler })).not.toBeVisible();
});

test('the group links come from admin settings, and the admin lever clears a member', async ({
	page
}) => {
	const stamp = Date.now();
	const boss = `linkboss${stamp}`;
	const target = `target${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, target);
	expect((await page.request.post(`/test/approve?username=${target}`)).ok()).toBeTruthy();

	// The member lists something.
	await signIn(page, target);
	await page.goto('/settings');
	await fillStable(page, 'Tumblr handle', `blog${stamp}`);
	await page.getByRole('button', { name: 'Save socials' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await signOut(page);

	// The admin sets a group link; the Socials page carries it up top.
	await signIn(page, boss);
	await page.goto('/admin/settings');
	await fillStable(page, 'Group link 1 name', 'The group chat');
	await fillStable(page, 'Group link 1 address', 'https://t.me/example');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.getByRole('link', { name: 'The group chat' })).toBeVisible();
	await expect(page.locator('.socials-roster li').filter({ hasText: target })).toBeVisible();

	// The moderation lever: the links go, the log keeps the line.
	await page.goto('/admin/members');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: target })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByText('Clear their socials').click();
	await page.getByRole('button', { name: 'Yes, clear them' }).click();
	await page.locator('.rail').getByRole('link', { name: 'Socials' }).click();
	await expect(page.locator('.socials-roster li').filter({ hasText: target })).not.toBeVisible();
	await page.goto('/admin/log');
	await expect(page.getByText('cleared the socials').first()).toBeVisible();
});
