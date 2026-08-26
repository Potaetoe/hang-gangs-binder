// Calculated fields (DESIGN.md feature 7, owner rulings 2026-08-26):
// an admin builds a recipe with the guided builder, previews it, puts
// it on the form - and every member surface carries the number with
// no code change. BMI rides the same engine now, recipe locked.
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

function entryRow(page: Page, texts: string[]) {
	let row = page.locator('.entries-table tbody tr');
	for (const text of texts) row = row.filter({ hasText: text });
	return row;
}

async function addCalculatedField(page: Page, name: string) {
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, name);
	await page.getByLabel(/what kind of answer/i).selectOption('calculated');
	await page.getByRole('button', { name: 'Add the field' }).click();
	await expect(page.getByText('No recipe yet')).toBeVisible();
}

test('a gain recipe reaches the form, the table, both unit systems, and the charts', async ({
	page
}) => {
	const stamp = Date.now();
	const boss = `chef${stamp}`;
	const member = `eater${stamp}`;
	const gain = `Gain ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// The admin builds: Weight minus Weight (first entry), following
	// the units toggle.
	await signIn(page, boss);
	await addCalculatedField(page, gain);
	await page.getByLabel(/what the recipe starts from/i).selectOption({ label: 'Weight' });
	await page.getByLabel('Step 1 operation').selectOption({ label: '−' });
	await page.getByLabel('Step 1 reads').selectOption({ label: 'Weight (first entry)' });

	// The preview shows the arithmetic before anything is saved:
	// 100 − 90 = 10.
	await page.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByText(/first entry 90, previous 95/)).toBeVisible();
	await expect(page.locator('.done strong')).toHaveText('10');

	await page.getByRole('button', { name: 'Save the recipe' }).click();
	await expect(page.getByText(/Now: Weight − Weight \(first entry\)/)).toBeVisible();
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	await expect(page.locator('.badge.pending')).not.toBeVisible();
	await signOut(page);

	// No code changed. The member's form carries the note, and two
	// entries make a gain: 190 − 180 in pounds, 86.2 − 81.6 in kilos.
	await signIn(page, member);
	await expect(page.getByText(`${gain} is worked out from Weight.`)).toBeVisible();
	await fillStable(page, 'Weight', '180');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['180 lb', '0'])).toBeVisible();
	await fillStable(page, 'Weight', '190');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['190 lb', '10'])).toBeVisible();
	await page.getByRole('link', { name: 'Metric' }).click();
	await expect(entryRow(page, ['86.2 kg', '4.6'])).toBeVisible();

	// The charts already know it.
	await page.goto('/charts');
	await expect(page.locator('.tile').filter({ hasText: gain })).toBeVisible();
});

test('BMI rides the engine now, and its recipe cannot be rewritten', async ({ page }) => {
	const stamp = Date.now();
	const boss = `warden${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	await signIn(page, boss);
	await page.goto('/admin/form');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: 'BMI' })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.getByText(/BMI's recipe is fixed/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save the recipe' })).not.toBeVisible();

	// And it still computes what it always computed: 185 lb at
	// 5 ft 10 in reads 26.5, same as before the migration.
	await page.goto('/home');
	await fillStable(page, /height, feet/i, '5');
	await fillStable(page, /height, inches/i, '10');
	await fillStable(page, 'Weight', '185');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['185 lb', '26.5'])).toBeVisible();
});

test('retiring a recipe input warns, blanks the number, and return restores it', async ({
	page
}) => {
	const stamp = Date.now();
	const boss = `pruner${stamp}`;
	const fuel = `Fuel ${stamp}`;
	const burn = `Burn ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	// A plain field, and a recipe that reads it.
	await signIn(page, boss);
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, fuel);
	await page.getByLabel(/what kind of answer/i).selectOption('plain');
	await page.getByRole('button', { name: 'Add the field' }).click();
	await addCalculatedField(page, burn);
	await page.getByLabel(/what the recipe starts from/i).selectOption({ label: fuel });
	await page.getByRole('button', { name: 'Save the recipe' }).click();
	await page.getByRole('button', { name: 'Put it on the form' }).click();

	// One entry computes.
	await page.goto('/home');
	await fillStable(page, fuel, '50');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['50'])).toBeVisible();

	// The retire flap names the recipe that goes dark.
	await page.goto('/admin/form');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: fuel })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByText('Take it off the form').click();
	await expect(page.getByText(`Careful: ${burn} reads this field`)).toBeVisible();
	await page.getByRole('button', { name: 'Yes, take it off' }).click();

	// New entries carry a blank, never a stale carry-forward.
	await page.goto('/home');
	await fillStable(page, 'Weight', '200');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['200 lb'])).toBeVisible();
	await expect(entryRow(page, ['200 lb'])).not.toContainText('50');

	// The field returns; the recipe wakes up.
	await page.goto('/admin/form');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: fuel })
		.getByRole('link', { name: 'Open' })
		.click();
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	await page.goto('/home');
	await fillStable(page, fuel, '60');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['60'])).toBeVisible();
});

test('a one-number recipe with constants ignores the units toggle', async ({ page }) => {
	const stamp = Date.now();
	const boss = `targeter${stamp}`;
	const pct = `Pct ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	// Weight ÷ 300 × 100 from metric numbers, one answer for everyone.
	await signIn(page, boss);
	await addCalculatedField(page, pct);
	await page.getByLabel(/what the recipe starts from/i).selectOption({ label: 'Weight' });
	await page.getByLabel('Step 1 operation').selectOption({ label: '÷' });
	await page.getByLabel('Step 1 reads').selectOption({ label: 'a number you type' });
	await fillStable(page, 'Step 1 typed number', '300');
	await page.getByLabel('Step 2 operation').selectOption({ label: '×' });
	await page.getByLabel('Step 2 reads').selectOption({ label: 'a number you type' });
	await fillStable(page, 'Step 2 typed number', '100');
	await page.getByLabel(/whose numbers it reads/i).selectOption({ index: 1 });
	await page.getByRole('button', { name: 'Save the recipe' }).click();
	await expect(page.getByText(/one number for everyone/)).toBeVisible();
	await page.getByRole('button', { name: 'Put it on the form' }).click();

	// 180 lb stores as 81.6 kg; 81.6 ÷ 300 × 100 = 27.2 - in BOTH
	// views, because the recipe reads metric for everyone.
	await page.goto('/home');
	await fillStable(page, 'Weight', '180');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(entryRow(page, ['180 lb', '27.2'])).toBeVisible();
	await page.getByRole('link', { name: 'Metric' }).click();
	await expect(entryRow(page, ['81.6 kg', '27.2'])).toBeVisible();
});
