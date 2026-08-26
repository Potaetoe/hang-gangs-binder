// The calendar and events feature (DESIGN.md feature 5, owner rulings
// 2026-08-26), walked the way people use it: an admin puts an event on
// the calendar, and every member's home page shows it - grid, list,
// and gallery - with no code change anywhere.
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

/** A real 1x1 PNG, small enough to live in the test. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('an event an admin adds reaches every member home, gallery included', async ({ page }) => {
	const stamp = Date.now();
	const boss = `planner${stamp}`;
	const member = `guest${stamp}`;
	const title = `Cookout ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	await register(page, member);
	expect((await page.request.post(`/test/approve?username=${member}`)).ok()).toBeTruthy();

	// The admin fills the whole card: day, place, notes, one image.
	await signIn(page, boss);
	await page.goto('/admin/events');
	await fillStable(page, /what is happening/i, title);
	await fillStable(page, 'The day', '2031-05-15');
	await fillStable(page, /where/i, 'The park');
	await fillStable(page, /notes/i, 'Bring a chair.');
	await page
		.getByLabel(/^images/i)
		.setInputFiles({ name: 'flyer.png', mimeType: 'image/png', buffer: PNG });
	await page.getByRole('button', { name: 'Add the event' }).click();

	// The add lands on the event's own page, image stored.
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await expect(page.locator('.gallery img')).toHaveCount(1);

	// The list page carries the new row.
	await page.goto('/admin/events');
	const row = page.locator('.admin-table tbody tr').filter({ hasText: title });
	await expect(row).toBeVisible();
	await expect(row).toContainText('The park');
	await signOut(page);

	// No code changed. The member's calendar knows the day, the list
	// tells the story, the image arrives.
	await signIn(page, member);
	await page.goto('/home?cal=2031-05');
	await expect(page.locator('.cal-label')).toHaveText('May 2031');
	await expect(page.locator('a.cal-day.has-event', { hasText: '15' })).toBeVisible();
	const event = page.locator('.event').filter({ hasText: title });
	await expect(event).toBeVisible();
	await expect(event).toContainText('The park');
	await expect(event).toContainText('Bring a chair.');
	const imgSrc = await event.locator('.gallery img').getAttribute('src');
	expect(imgSrc).toBeTruthy();
	const img = await page.request.get(imgSrc!);
	expect(img.ok()).toBeTruthy();
	expect(img.headers()['content-type']).toBe('image/png');

	// The arrows flip months without losing the page.
	await page.getByRole('link', { name: 'Later month' }).click();
	await expect(page.locator('.cal-label')).toHaveText('June 2031');
	await page.getByRole('link', { name: 'Earlier month' }).click();
	await expect(page.locator('.cal-label')).toHaveText('May 2031');

	// Signed out, the image URL admits nothing.
	await signOut(page);
	expect((await page.request.get(imgSrc!)).status()).toBe(404);
});

test('an admin edits and then deletes an event, and the log keeps score', async ({ page }) => {
	const stamp = Date.now();
	const boss = `mover${stamp}`;
	const title = `Meetup ${stamp}`;
	const moved = `Moved ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	await signIn(page, boss);
	await page.goto('/admin/events');
	await fillStable(page, /what is happening/i, title);
	await fillStable(page, 'The day', '2031-07-04');
	await page.getByRole('button', { name: 'Add the event' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();

	// The edit: new name, new day.
	await fillStable(page, /what is happening/i, moved);
	await fillStable(page, 'The day', '2031-07-05');
	await page.getByRole('button', { name: 'Save the event' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	// The member view follows the change.
	await page.goto('/home?cal=2031-07');
	await expect(page.locator('.event').filter({ hasText: moved })).toBeVisible();
	await expect(page.locator('a.cal-day.has-event', { hasText: '5' }).first()).toBeVisible();

	// The delete, from behind its flap.
	await page.goto('/admin/events');
	await page.locator('.admin-table tbody tr').filter({ hasText: moved }).getByRole('link').click();
	await page.getByText('Delete this event').click();
	await page.getByRole('button', { name: 'Yes, delete it' }).click();
	await expect(page.locator('.admin-table tbody tr').filter({ hasText: moved })).not.toBeVisible();
	await page.goto('/home?cal=2031-07');
	await expect(page.getByText('Nothing on the calendar this month.')).toBeVisible();

	// Three actions, three lines.
	await page.goto('/admin/log');
	await expect(page.getByText('added an event').first()).toBeVisible();
	await expect(page.getByText('changed an event').first()).toBeVisible();
	await expect(page.getByText('deleted an event').first()).toBeVisible();
});

test('a file that is not a small image is skipped and said so', async ({ page }) => {
	const stamp = Date.now();
	const boss = `bouncer${stamp}`;
	const title = `Gala ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	await signIn(page, boss);
	await page.goto('/admin/events');
	await fillStable(page, /what is happening/i, title);
	await fillStable(page, 'The day', '2031-09-01');
	await page
		.getByLabel(/^images/i)
		.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('words') });
	await page.getByRole('button', { name: 'Add the event' }).click();

	// The event stands; the file did not make it, and the page says so.
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await expect(page.getByText(/did not make it/)).toBeVisible();
	await expect(page.getByText('No images yet.')).toBeVisible();

	// An event needs its title and a day - all faults at once. (The
	// browser itself refuses to type an impossible date into the
	// picker; the server-side round-trip check is for raw requests.)
	await page.goto('/admin/events');
	await page.getByRole('button', { name: 'Add the event' }).click();
	await expect(page.getByText('An event needs a title.')).toBeVisible();
	await expect(page.getByText('Pick a real day for it.')).toBeVisible();
});
