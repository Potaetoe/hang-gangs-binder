// The form builder (build order step 5) and THE acceptance test from
// DESIGN.md: a field an admin adds appears on the member form and in
// the chart filters without any code change. Walked as the admin who
// shapes the form and the member who fills it.
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

test('THE acceptance test: an added field reaches the form and the filters', async ({ page }) => {
	const stamp = Date.now();
	const boss = `shaper${stamp}`;
	const member = `filler${stamp}`;
	const fieldName = `Team ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// The admin adds a choice field; it waits off the form for options.
	await signIn(page, boss);
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, fieldName);
	await page.getByLabel(/what kind of answer/i).selectOption('choice');
	await page.getByRole('button', { name: 'Add the field' }).click();
	await expect(page.locator('.badge.pending')).toBeVisible();

	// Options arrive; the field goes on the form.
	await fillStable(page, 'New option', 'Red');
	await page.getByRole('button', { name: 'Add option' }).click();
	await fillStable(page, 'New option', 'Blue');
	await page.getByRole('button', { name: 'Add option' }).click();
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	await expect(page.locator('.badge.pending')).not.toBeVisible();
	await signOut(page);

	// No code changed. The member's form asks the new question.
	await signIn(page, member);
	await expect(page.getByLabel(fieldName)).toBeVisible();
	await fillStable(page, 'Weight', '180');
	await page.getByLabel(fieldName).selectOption('Red');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: 'Red' })).toBeVisible();

	// And the charts already know it: a tile on the board, a filter on
	// the focused page.
	await page.goto('/charts');
	await expect(page.locator('.tile').filter({ hasText: fieldName })).toBeVisible();
	await page.locator('.tile').filter({ hasText: 'Weight' }).click();
	await page.getByLabel(fieldName).selectOption('Red');
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.locator('.stat').filter({ hasText: '180 lb' })).toBeVisible();
	await expect(page.getByText(/^1 of \d+/).first()).toBeVisible();
});

test("renaming an option renames everyone's history", async ({ page }) => {
	const stamp = Date.now();
	const boss = `renamer${stamp}`;
	const member = `carrier${stamp}`;
	const fieldName = `Crew ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// Field with one option, member picks it.
	await signIn(page, boss);
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, fieldName);
	await page.getByLabel(/what kind of answer/i).selectOption('choice');
	await page.getByRole('button', { name: 'Add the field' }).click();
	await fillStable(page, 'New option', 'Old Guard');
	await page.getByRole('button', { name: 'Add option' }).click();
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	const fieldUrl = page.url();
	await signOut(page);

	await signIn(page, member);
	await page.getByLabel(fieldName).selectOption('Old Guard');
	await fillStable(page, 'Weight', '170');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: 'Old Guard' })).toBeVisible();
	await signOut(page);

	// The admin renames the option; the member's history follows.
	await signIn(page, boss);
	await page.goto(fieldUrl);
	await page.locator('summary').filter({ hasText: 'Rename' }).click();
	await fillStable(page, /new name for old guard/i, 'Vanguard');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: 'Vanguard' })).toBeVisible();
	await signOut(page);

	await signIn(page, member);
	await expect(page.locator('.entry-summary').filter({ hasText: 'Vanguard' })).toBeVisible();
	await expect(page.locator('.entry-summary').filter({ hasText: 'Old Guard' })).not.toBeVisible();
});

test('pick-several: ticks reach history, the counts, and the all-of filter', async ({ page }) => {
	const stamp = Date.now();
	const boss = `snacker${stamp}`;
	const member = `taster${stamp}`;
	const fieldName = `Snacks ${stamp}`;
	const sweet = `Sweet ${stamp}`;
	const salty = `Salty ${stamp}`;
	const sour = `Sour ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// The admin builds a pick-several field.
	await signIn(page, boss);
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, fieldName);
	await page.getByLabel(/what kind of answer/i).selectOption('multi');
	await page.getByRole('button', { name: 'Add the field' }).click();
	await expect(page.locator('.badge').filter({ hasText: 'pick several' })).toBeVisible();
	for (const option of [sweet, salty, sour]) {
		await fillStable(page, 'New option', option);
		await page.getByRole('button', { name: 'Add option' }).click();
	}
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	await signOut(page);

	// The member ticks two boxes; the answer is the set of picks.
	await signIn(page, member);
	await page.getByRole('checkbox', { name: sweet }).check();
	await page.getByRole('checkbox', { name: sour }).check();
	await fillStable(page, 'Weight', '180');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(
		page.locator('.entry-summary').filter({ hasText: `${sweet}, ${sour}` })
	).toBeVisible();

	// The charts count every pick: one member, two bars.
	await page.goto('/charts');
	await page.locator('.tile').filter({ hasText: fieldName }).click();
	await expect(page.locator('.countbar').filter({ hasText: sweet })).toBeVisible();
	await expect(page.locator('.countbar').filter({ hasText: sour })).toBeVisible();

	// The filter is checkboxes with all-of matching: both picks match,
	// a pick they skipped excludes them.
	await page.goto('/charts');
	await page.locator('.tile').filter({ hasText: 'Weight' }).click();
	await page.getByRole('checkbox', { name: sweet }).check();
	await page.getByRole('checkbox', { name: sour }).check();
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.locator('.stat').filter({ hasText: '180 lb' })).toBeVisible();
	await page.getByRole('checkbox', { name: salty }).check();
	await page.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText('Nobody matches those filters yet.')).toBeVisible();

	// Unchecking every pre-checked box on a new entry means "none now":
	// the picks leave the newest entry and the counts.
	await page.goto('/home');
	await page.getByRole('checkbox', { name: sweet }).uncheck();
	await page.getByRole('checkbox', { name: sour }).uncheck();
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entry-summary').first()).not.toContainText(sweet);
	await page.goto('/charts');
	await page.locator('.tile').filter({ hasText: fieldName }).click();
	await expect(page.locator('.countbar').filter({ hasText: sweet })).not.toBeVisible();
	await expect(page.getByText(/^1 of \d+/).first()).toBeVisible();
});

test('a choice field switches to pick-several one way, history intact', async ({ page }) => {
	const stamp = Date.now();
	const boss = `switcher${stamp}`;
	const member = `singer${stamp}`;
	const fieldName = `Genre ${stamp}`;
	const anthems = `Anthems ${stamp}`;
	const ballads = `Ballads ${stamp}`;
	const hymns = `Hymns ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// A single-pick field collects a plain answer first.
	await signIn(page, boss);
	await page.goto('/admin/form');
	await fillStable(page, /what the form should ask/i, fieldName);
	await page.getByLabel(/what kind of answer/i).selectOption('choice');
	await page.getByRole('button', { name: 'Add the field' }).click();
	for (const option of [anthems, ballads]) {
		await fillStable(page, 'New option', option);
		await page.getByRole('button', { name: 'Add option' }).click();
	}
	await page.getByRole('button', { name: 'Put it on the form' }).click();
	const fieldUrl = page.url();
	await signOut(page);

	await signIn(page, member);
	await page.getByLabel(fieldName).selectOption(anthems);
	await fillStable(page, 'Weight', '170');
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(page.locator('.entry-summary').filter({ hasText: anthems })).toBeVisible();
	await signOut(page);

	// The switch is one flap, and one-way: the flap does not return.
	await signIn(page, boss);
	await page.goto(fieldUrl);
	await page.getByText('Let members pick several').click();
	await page.getByRole('button', { name: 'Yes, allow several' }).click();
	await expect(page.locator('.badge').filter({ hasText: 'pick several' })).toBeVisible();
	await expect(page.getByText('Let members pick several')).not.toBeVisible();
	await signOut(page);

	// The old single answer arrives pre-checked; a second pick joins it.
	await signIn(page, member);
	await expect(page.getByRole('checkbox', { name: anthems })).toBeChecked();
	await page.getByRole('checkbox', { name: ballads }).check();
	await page.getByRole('button', { name: 'Save entry' }).click();
	await expect(
		page.locator('.entry-summary').filter({ hasText: `${anthems}, ${ballads}` })
	).toBeVisible();
	await signOut(page);

	// Renaming an option rewrites BOTH shapes: the old plain answer and
	// the new pick-set.
	await signIn(page, boss);
	await page.goto(fieldUrl);
	await page.locator('summary').filter({ hasText: 'Rename' }).first().click();
	await fillStable(page, new RegExp(`new name for ${anthems}`, 'i'), hymns);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await signOut(page);

	await signIn(page, member);
	await expect(
		page.locator('.entry-summary').filter({ hasText: `${hymns}, ${ballads}` })
	).toBeVisible();
	await expect(page.locator('.entry-summary').filter({ hasText: anthems })).not.toBeVisible();
});

test('the essential three cannot leave, and unused fields can', async ({ page }) => {
	const stamp = Date.now();
	const boss = `keeper${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await signIn(page, boss);

	// Weight offers no retire control - it is essential.
	await page.goto('/admin/form');
	await page
		.locator('.admin-table tbody tr')
		.filter({ hasText: 'Weight' })
		.getByRole('link', { name: 'Open' })
		.click();
	await expect(page.getByText(/essential — they stay on the form/)).toBeVisible();
	await expect(page.getByText('Take it off the form')).not.toBeVisible();

	// A never-used field can be deleted outright.
	await page.goto('/admin/form');
	const doomed = `Doomed ${stamp}`;
	await fillStable(page, /what the form should ask/i, doomed);
	await page.getByLabel(/what kind of answer/i).selectOption('plain');
	await page.getByRole('button', { name: 'Add the field' }).click();
	// A number field goes straight on the form; take it off, then delete.
	await page.getByText('Take it off the form').click();
	await page.getByRole('button', { name: 'Yes, take it off' }).click();
	await page.getByText('Delete it', { exact: true }).click();
	await page.getByRole('button', { name: 'Yes, delete it' }).click();
	await expect(page.locator('.admin-table tbody tr').filter({ hasText: doomed })).not.toBeVisible();
});
