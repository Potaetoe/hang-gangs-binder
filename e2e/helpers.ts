// The moves every spec makes: filling a box, signing in and out, and
// making a member through the real registration form.
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'a-decent-password';

/** Fill, then read the value back, retrying until it is really there. */
export async function fillStable(page: Page, label: string | RegExp, value: string) {
	await expect(async () => {
		await page.getByLabel(label).fill(value);
		expect(await page.getByLabel(label).inputValue()).toBe(value);
	}).toPass({ timeout: 10_000 });
}

/** The password form waits behind a disclosure on the door. */
export async function openPasswordFlap(page: Page) {
	await expect(async () => {
		await page.getByText('With a password').click();
		await expect(page.getByLabel('Username')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 10_000 });
}

export async function register(page: Page, username: string, password = PASSWORD) {
	await page.goto('/register');
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', password);
	await page.getByRole('button', { name: /ask for the account/i }).click();
	await expect(page.getByText(/an admin has to approve/i)).toBeVisible();
}

export async function signIn(page: Page, username: string, password = PASSWORD) {
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
	await page.goto('/home');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
}

/** Register, approve through the test hook, and sign in: the shortest
 * honest path to a working member. */
export async function signInFreshMember(page: Page, username: string) {
	await register(page, username);
	const approved = await page.request.post(`/test/approve?username=${username}`);
	expect(approved.ok()).toBeTruthy();
	await signIn(page, username);
	await expect(
		page.getByRole('heading', { name: new RegExp(`hello, ${username}`, 'i') })
	).toBeVisible();
}

/** The row of the entries table that carries every given value. */
export function entryRow(page: Page, texts: string[]) {
	let row = page.locator('.entries-table tbody tr');
	for (const text of texts) row = row.filter({ hasText: text });
	return row;
}
