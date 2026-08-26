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

/** The entries-table row carrying every given value - the table
 * replaced the old summary line (owner ruling 2026-08-26). */
function entryRow(page: Page, texts: string[]) {
	let row = page.locator('.entries-table tbody tr');
	for (const text of texts) row = row.filter({ hasText: text });
	return row;
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
	await expect(
		entryRow(page, ['5 ft 10 in', '185 lb', '26.5', 'Male', 'United States'])
	).toBeVisible();

	// The form pre-fills what it already knows.
	expect(await page.getByLabel(/height, feet/i).inputValue()).toBe('5');
	expect(await page.getByLabel('Weight').inputValue()).toBe('185');

	// A second entry gives every number a trend.
	await fillStable(page, 'Weight', '187');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText('Your trends')).toBeVisible();
	await expect(page.locator('.trend').filter({ hasText: 'Weight' })).toBeVisible();

	// Metric shows the same entry in the other system.
	await page.getByRole('button', { name: 'Metric' }).click();
	await expect(page.getByText('84.8 kg').first()).toBeVisible();
	await page.getByRole('button', { name: /imperial/i }).click();

	// A correction: 187 was a typo for 186.
	await entryRow(page, ['187 lb']).getByRole('link', { name: 'Edit' }).click();
	await expect(page.getByRole('heading', { name: /entry from/i })).toBeVisible();
	await fillStable(page, 'Weight', '186');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(entryRow(page, ['186 lb'])).toBeVisible();

	// A deletion: the first entry goes, from behind its flap.
	await entryRow(page, ['185 lb']).getByRole('link', { name: 'Edit' }).click();
	await page.getByText('Delete this entry').click();
	await page.getByRole('button', { name: /yes, delete it/i }).click();
	await expect(entryRow(page, ['185 lb'])).not.toBeVisible();

	// Both corrections left their trail for admin review. Same-day
	// rows have no stored order (the no-timestamp privacy rule), so
	// the actions are compared sorted.
	const audit = await page.request.get(`/test/audit?username=${username}`);
	expect(audit.ok()).toBeTruthy();
	const trail = (await audit.json()) as { action: string }[];
	expect(trail.map((row) => row.action).sort()).toEqual(['delete', 'edit']);
});

test('a metric member types kilograms and centimeters', async ({ page }) => {
	const username = `metric${Date.now()}`;
	await signInFreshMember(page, username);

	await page.getByRole('button', { name: 'Metric' }).click();
	await fillStable(page, 'Height', '178');
	await fillStable(page, 'Weight', '84');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['178 cm', '84 kg', '26.5'])).toBeVisible();

	// The same entry back in American: both systems were stored.
	await page.getByRole('button', { name: /imperial/i }).click();
	await expect(entryRow(page, ['5 ft 10.1 in', '185.2 lb', '26.5'])).toBeVisible();
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

test('a number too big to be real is refused, and the charts survive', async ({ page }) => {
	const username = `giant${Date.now()}`;
	await signInFreshMember(page, username);

	// Twenty digits of weight. The ceiling matters twice: once for the
	// member's own page, and once because the histogram sizes itself
	// from the spread of stored values - one absurd number used to be
	// able to break Group Stats for everyone (fix pass 2026-08-25).
	await fillStable(page, 'Weight', '99999999999999999999');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText(/weight: enter a number above zero, below a million/i)).toBeVisible();
	await expect(page.getByText('No entries yet')).toBeVisible();

	// A real weight saves, and the board still draws.
	await fillStable(page, 'Weight', '205');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entries-table tbody tr').first()).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Group Stats' }).click();
	await expect(page.locator('.tile').filter({ hasText: 'Weight' })).toBeVisible();
});

test('a cleared field keeps its last value on a new entry', async ({ page }) => {
	const username = `keeper${Date.now()}`;
	await signInFreshMember(page, username);

	await fillStable(page, /height, feet/i, '5');
	await fillStable(page, /height, inches/i, '10');
	await fillStable(page, 'Weight', '185');
	await page.getByLabel('Gender').selectOption('Male');
	await page.getByRole('button', { name: 'Save entry' }).click();

	// The next day's habit: clear the pre-filled height, type only the
	// new weight. The binder keeps what it already knew.
	await fillStable(page, /height, feet/i, '');
	await fillStable(page, /height, inches/i, '');
	await fillStable(page, 'Weight', '190');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['5 ft 10 in', '190 lb', '27.3', 'Male'])).toBeVisible();
});

test('six foot nothing is a height, and America leads the country list', async ({ page }) => {
	const username = `sixfoot${Date.now()}`;
	await signInFreshMember(page, username);

	// The owner's drive found the zero: 6 ft 0 in must save.
	await fillStable(page, /height, feet/i, '6');
	await fillStable(page, /height, inches/i, '0');
	await fillStable(page, 'Weight', '240');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['6 ft 0 in', '240 lb'])).toBeVisible();

	// The country list leads with the group's actual countries.
	await expect(page.getByLabel('Country').locator('option').nth(1)).toHaveText('United States');
	await expect(page.getByLabel('Country').locator('option').nth(2)).toHaveText('United Kingdom');
	await expect(page.getByLabel('Country').locator('option').nth(5)).toHaveText('Mexico');
});

test('an empty submit saves nothing and says so', async ({ page }) => {
	const username = `blank${Date.now()}`;
	await signInFreshMember(page, username);
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.getByText(/nothing to save yet/i)).toBeVisible();
});

test('the settings units default survives a page toggle', async ({ page }) => {
	const username = `unitary${Date.now()}`;
	await signInFreshMember(page, username);

	// Metric becomes the DEFAULT, chosen in Settings.
	await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
	const unitsSetting = page.locator('.setting').filter({ hasText: 'Units' });
	await unitsSetting.getByRole('button', { name: 'Metric' }).click();
	await expect(unitsSetting.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// The home form arrives metric.
	await page.goto('/home');
	await expect(page.getByText('cm', { exact: true })).toBeVisible();

	// The page toggle flips the VIEW to imperial - and Settings still
	// says Metric, because a view is not the default (owner ruling
	// 2026-08-26).
	await page.getByRole('button', { name: /imperial/i }).click();
	await expect(page.getByLabel(/height, feet/i)).toBeVisible();
	await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
	await expect(unitsSetting.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('the shown name can be changed by its member', async ({ page }) => {
	const username = `renamer${Date.now()}`;
	await signInFreshMember(page, username);

	await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
	await fillStable(page, 'Name to show', 'Slimmy');
	await page.getByRole('button', { name: 'Save name' }).click();
	await page.goto('/home');
	await expect(page.getByRole('heading', { name: /hello, slimmy/i })).toBeVisible();
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
