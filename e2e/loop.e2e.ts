// The core loop (DESIGN.md, "Core loop"; owner rulings 2026-08-24),
// driven the way a person drives it: sign in, put numbers in, read
// them back, correct them, and watch the corrections leave a trail.
import { expect, test, type Page } from '@playwright/test';

/** Same guard as the door suite: fill-and-verify beats hydration
 * replay without racing it. */
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

/** Register, approve through the test hook, sign in - the shortest
 * legitimate path to a member on their page. */
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

test('a member logs stats, reads them back, corrects and deletes, leaving a trail', async ({
	page
}) => {
	const username = `looper${Date.now()}`;
	await signInFreshMember(page, username);

	// The form arrives American: feet and inches, pounds.
	await fillStable(page, /height, feet/i, '5');
	await fillStable(page, /height, inches/i, '10');
	await fillStable(page, 'Weight', '185');
	await page.getByLabel('Gender').selectOption('Male');
	await page.getByLabel('Country').selectOption('United States');
	await page.getByRole('button', { name: 'Save entry' }).click();

	// The entry reads back in the units it was typed in, with BMI
	// worked out (185 lb at 5 ft 10 in is 26.5).
	await expect(page.getByText('5 ft 10 in · 185 lb · 26.5 · Male · United States')).toBeVisible();

	// The form pre-fills what it already knows.
	expect(await page.getByLabel(/height, feet/i).inputValue()).toBe('5');
	expect(await page.getByLabel('Weight').inputValue()).toBe('185');

	// A second entry gives every number a trend.
	await fillStable(page, 'Weight', '187');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText('Trends')).toBeVisible();
	await expect(page.locator('.trend').filter({ hasText: 'Weight' })).toBeVisible();

	// Metric shows the same entry in the other system.
	await page.getByRole('button', { name: 'Metric' }).click();
	await expect(page.getByText('84.8 kg').first()).toBeVisible();
	await page.getByRole('button', { name: 'Imperial' }).click();

	// A correction: 187 was a typo for 186.
	await page
		.locator('.history li')
		.filter({ hasText: '187 lb' })
		.getByRole('link', { name: 'Edit' })
		.click();
	await expect(page.getByRole('heading', { name: /entry from/i })).toBeVisible();
	await fillStable(page, 'Weight', '186');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: '186 lb' })).toBeVisible();

	// A deletion: the first entry goes, from behind its flap.
	await page
		.locator('.history li')
		.filter({ hasText: '185 lb' })
		.getByRole('link', { name: 'Edit' })
		.click();
	await page.getByText('Delete this entry').click();
	await page.getByRole('button', { name: /yes, delete it/i }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: '185 lb' })).not.toBeVisible();

	// Both corrections left their trail for admin review.
	const audit = await page.request.get(`/test/audit?username=${username}`);
	expect(audit.ok()).toBeTruthy();
	const trail = (await audit.json()) as { action: string }[];
	expect(trail.map((row) => row.action)).toEqual(['edit', 'delete']);
});

test('a metric member types kilograms and centimeters', async ({ page }) => {
	const username = `metric${Date.now()}`;
	await signInFreshMember(page, username);

	await page.getByRole('button', { name: 'Metric' }).click();
	await fillStable(page, 'Height', '178');
	await fillStable(page, 'Weight', '84');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText('178 cm · 84 kg · 26.5')).toBeVisible();

	// The same entry back in American: both systems were stored.
	await page.getByRole('button', { name: 'Imperial' }).click();
	await expect(page.getByText('5 ft 10.1 in · 185.2 lb · 26.5')).toBeVisible();
});

test('a broken number is refused without losing the rest of the form', async ({ page }) => {
	const username = `fumble${Date.now()}`;
	await signInFreshMember(page, username);

	await fillStable(page, 'Weight', 'lots');
	await page.getByLabel('Gender').selectOption('Other');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText(/weight: enter a number above zero/i)).toBeVisible();
	// The choice survived the round trip.
	expect(await page.getByLabel('Gender').inputValue()).toBe('Other');
	// Nothing was saved.
	await expect(page.getByText('No entries yet')).toBeVisible();
});

test('an empty submit saves nothing and says so', async ({ page }) => {
	const username = `blank${Date.now()}`;
	await signInFreshMember(page, username);
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText(/nothing to save yet/i)).toBeVisible();
});

test('the shown name can be changed by its member', async ({ page }) => {
	const username = `renamer${Date.now()}`;
	await signInFreshMember(page, username);

	await page.getByText('Called something else?').click();
	await fillStable(page, 'Name to show', 'Slim');
	await page.getByRole('button', { name: 'Save name' }).click();
	await expect(page.getByRole('heading', { name: /hello, slim/i })).toBeVisible();
});

test('another member entry answers not-found, not forbidden', async ({ page }) => {
	const alice = `alice${Date.now()}`;
	await signInFreshMember(page, alice);
	await fillStable(page, 'Weight', '150');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await page.getByRole('link', { name: 'Edit' }).click();
	const entryUrl = page.url();

	// A second member signs in on the same browser and tries the URL.
	await page.goto('/home');
	await page.getByRole('button', { name: 'Sign out' }).click();
	const mallory = `mallory${Date.now()}`;
	await signInFreshMember(page, mallory);
	const response = await page.goto(entryUrl);
	expect(response?.status()).toBe(404);
});
