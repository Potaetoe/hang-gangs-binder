// The charts (build order step 3, owner rulings 2026-08-24): the
// board, a focused field, combined filters - floorless - and units,
// walked the way a person walks them.
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

async function signInFreshMember(page: Page, username: string) {
	await page.goto('/register');
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: /ask for the account/i }).click();
	await expect(page.getByText(/an admin has to approve/i)).toBeVisible();
	const approved = await page.request.post(`/test/approve?username=${username}`);
	expect(approved.ok()).toBeTruthy();
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(
		page.getByRole('heading', { name: new RegExp(`hello, ${username}`, 'i') })
	).toBeVisible();
}

async function logEntry(
	page: Page,
	entry: { ft?: string; inches?: string; weight: string; gender: string; country: string }
) {
	if (entry.ft) await fillStable(page, /height, feet/i, entry.ft);
	if (entry.inches) await fillStable(page, /height, inches/i, entry.inches);
	await fillStable(page, 'Weight', entry.weight);
	await page.getByLabel('Gender').selectOption(entry.gender);
	await page.getByLabel('Country').selectOption(entry.country);
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entries-table tbody tr').first()).toBeVisible();
}

async function signOut(page: Page) {
	await page.goto('/home');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
}

test('three members chart, and one filter finds the average', async ({ page }) => {
	const stamp = Date.now();
	// The suite's own little group. Every test's data lives in the same
	// database, so all assertions filter down to THESE members' country
	// pair - a country no other test uses.
	await signInFreshMember(page, `chartone${stamp}`);
	await logEntry(page, {
		ft: '5',
		inches: '10',
		weight: '200',
		gender: 'Male',
		country: 'Iceland'
	});
	await signOut(page);
	await signInFreshMember(page, `charttwo${stamp}`);
	await logEntry(page, { weight: '250', gender: 'Male', country: 'Norway' });
	await signOut(page);
	await signInFreshMember(page, `chartthree${stamp}`);
	await logEntry(page, { weight: '150', gender: 'Female', country: 'Iceland' });

	// The rail carries them to the board. The page title is for screen
	// readers only - the rail says where you are (owner, 2026-08-26).
	await page.locator('.rail').getByRole('link', { name: 'Group Stats' }).click();
	await expect(page.getByText(/\d+ members/)).toBeVisible();
	await expect(page.locator('.tile').filter({ hasText: 'Weight' })).toBeVisible();

	// Into the focused field.
	await page.locator('.tile').filter({ hasText: 'Weight' }).click();
	await expect(page.getByRole('heading', { name: 'Weight' })).toBeVisible();

	// Filter: men from Iceland - exactly one member, shown floorless.
	// The viewer is a woman, so no "you are here" marker may show.
	await page.getByLabel('Gender').selectOption('Male');
	await page.getByLabel('Country').selectOption('Iceland');
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.locator('.stat').filter({ hasText: '200 lb' })).toBeVisible();
	await expect(page.getByText(/^1 of \d+/).first()).toBeVisible();
	await expect(page.getByText(/you are here/)).not.toBeVisible();

	// The same member in the other system: both were stored.
	await page.getByRole('link', { name: 'Metric' }).click();
	await expect(page.locator('.stat').filter({ hasText: '90.7 kg' })).toBeVisible();
	await page.getByRole('link', { name: /imperial/i }).click();

	// Loosen to everyone from Iceland: two members averaged, and the
	// viewer is one of them - now the marker may speak.
	await page.getByLabel('Gender').selectOption('');
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.locator('.stat').filter({ hasText: '175 lb' })).toBeVisible();
	await expect(page.getByText(/^2 of \d+/).first()).toBeVisible();
	await expect(page.getByText(/you are here: 150 lb/)).toBeVisible();

	// Every bar explains itself: fixed 20 lb buckets, range and share.
	await expect(page.locator('.dist-bar').first()).toHaveAttribute(
		'data-label',
		'140–160 lb · 1 member'
	);

	// A choice field focuses into counts.
	await page.locator('.fieldlist').getByRole('link', { name: 'Gender' }).click();
	await expect(page.getByRole('heading', { name: 'Gender' })).toBeVisible();
	// Exact text: hasText is case-insensitive, and "Female" hides a
	// "male" inside it.
	await expect(page.locator('.countbar-label').filter({ hasText: /^Male$/ })).toBeVisible();
});

test('the rail is a bottom bar on the phone and wears the brand on desktop', async ({ page }) => {
	const username = `railcheck${Date.now()}`;
	await signInFreshMember(page, username);

	// Desktop (the default viewport): top bar with the brand pair.
	await expect(page.locator('.rail-brand-name')).toBeVisible();
	await expect(page.locator('.rail-brand-name')).toHaveText('Hang Gang');

	// Phone: the brand hides and the rail slims to four stops (owner
	// ruling 2026-08-26) - Sign out moves into Settings there.
	await page.setViewportSize({ width: 375, height: 812 });
	await page.reload();
	await expect(page.locator('.rail-brand-name')).not.toBeVisible();
	await expect(page.locator('.rail').getByRole('link', { name: 'Group Stats' })).toBeVisible();
	await expect(page.locator('.rail').getByRole('button', { name: 'Sign out' })).not.toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByRole('button', { name: 'Sign out on this device' })).toBeVisible();
});
