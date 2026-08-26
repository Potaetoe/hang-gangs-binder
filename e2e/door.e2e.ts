// The door's feature loops (DESIGN.md, "Sign-in: two doors"), driven
// the way a person drives them. The Telegram loop signs a real payload
// with the local test bot token from .dev.vars; membership comes from
// TELEGRAM_ALLOW_IDS, so no test ever calls Telegram.
import { createHash, createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// Matches .dev.vars, which the preview server reads.
const TEST_BOT_TOKEN = 'local-test-bot-token';
const ALLOWED_TELEGRAM_ID = '7000001';

/** Hydration replays a page's initial state, wiping anything typed
 * before it finished - real users on slow phones included. Until the
 * app carries a hydration marker, fill-and-verify keeps the loops
 * honest without racing. */
async function fillStable(page: Page, label: string | RegExp, value: string) {
	await expect(async () => {
		await page.getByLabel(label).fill(value);
		expect(await page.getByLabel(label).inputValue()).toBe(value);
	}).toPass({ timeout: 10_000 });
}

async function openPasswordFlap(page: Page) {
	// Hydration replays the flap's initial closed state over a click
	// that beat it - the same replay that wipes early-filled inputs -
	// so opening retries until it sticks.
	await expect(async () => {
		await page.getByText('With a password').click();
		await expect(page.getByLabel('Username')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 10_000 });
}

function signedTelegramQuery(fields: Record<string, string>): string {
	const dataCheck = Object.keys(fields)
		.sort()
		.map((k) => `${k}=${fields[k]}`)
		.join('\n');
	const secret = createHash('sha256').update(TEST_BOT_TOKEN).digest();
	const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
	return new URLSearchParams({ ...fields, hash }).toString();
}

test('a stranger asks for an account, an admin approves, they sign in, they sign out', async ({
	page,
	request
}) => {
	const username = `walkin${Date.now()}`;

	await page.goto('/');
	// The register link lives inside the password flap now - a new
	// person's real path is: open the flap, then ask.
	await openPasswordFlap(page);
	await page.getByRole('link', { name: /ask for an account/i }).click();
	// The door has a Username field too - wait for the register page
	// before filling, or the fill lands on the page being left.
	await expect(page.getByRole('heading', { name: 'Ask for an account' })).toBeVisible();
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Name to show (optional)', 'Walk-in');
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: /ask for the account/i }).click();
	await expect(page.getByText(/an admin has to approve/i)).toBeVisible();

	// Signing in before approval is refused, with the pending reason.
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByText(/waiting for an admin/i)).toBeVisible();

	// The admin approves (the test hook plays the admin surface until
	// that feature exists).
	const approved = await request.post(`/test/approve?username=${username}`);
	expect(approved.ok()).toBeTruthy();

	await fillStable(page, 'Username', username);
	await fillStable(page, 'Password', 'a-decent-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('heading', { name: /hello, walk-in/i })).toBeVisible();

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
});

test('a wrong password gets one unrevealing message', async ({ page }) => {
	await page.goto('/');
	await openPasswordFlap(page);
	await fillStable(page, 'Username', 'nobody_here');
	await fillStable(page, 'Password', 'wrong-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByText(/did not match/i)).toBeVisible();
});

test('a group member signs in through the Telegram door', async ({ page }) => {
	const query = signedTelegramQuery({
		id: ALLOWED_TELEGRAM_ID,
		first_name: 'Tel',
		last_name: 'Member',
		username: 'tel_member',
		auth_date: String(Math.floor(Date.now() / 1000))
	});
	await page.goto(`/auth/telegram?${query}`);
	await expect(page.getByRole('heading', { name: /hello, tel member/i })).toBeVisible();
	// The allow-list marks the operator as admin: the name wears the
	// accent and the rail carries the Admin door (owner, 2026-08-26).
	await expect(page.locator('h1 .admin-name')).toBeVisible();
	await expect(page.locator('.rail').getByRole('link', { name: 'Admin' })).toBeVisible();
});

test('a forged Telegram payload is refused', async ({ page }) => {
	const query = signedTelegramQuery({
		id: ALLOWED_TELEGRAM_ID,
		first_name: 'Forged',
		auth_date: String(Math.floor(Date.now() / 1000))
	});
	await page.goto(`/auth/telegram?${query.replace(/hash=\w{8}/, 'hash=00000000')}`);
	await expect(page.getByText(/could not be verified/i)).toBeVisible();
});

test('a Telegram sign-in link works once and is dead after that', async ({ page }) => {
	// The signed payload rides in a URL, so a captured link used to be a
	// working key for as long as its window lasted. It is spent on first
	// use now (security pass, 2026-08-24).
	const query = signedTelegramQuery({
		id: '7000002',
		first_name: 'Replay',
		last_name: 'Target',
		username: 'replay_target',
		auth_date: String(Math.floor(Date.now() / 1000))
	});

	await page.goto(`/auth/telegram?${query}`);
	await expect(page.getByRole('heading', { name: /hello, replay target/i })).toBeVisible();

	// The same link again buys nothing - the payload is spent.
	await page.goto(`/auth/telegram?${query}`);
	await expect(page.getByText(/could not be verified/i)).toBeVisible();
});

test('a stale Telegram payload is refused even though it is signed', async ({ page }) => {
	const query = signedTelegramQuery({
		id: '7000003',
		first_name: 'Stale',
		auth_date: String(Math.floor(Date.now() / 1000) - 3600)
	});
	await page.goto(`/auth/telegram?${query}`);
	await expect(page.getByText(/could not be verified/i)).toBeVisible();
});

test('every response carries the security headers', async ({ page }) => {
	const response = await page.goto('/');
	const headers = response!.headers();
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['content-security-policy']).toContain('https://telegram.org');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['x-robots-tag']).toContain('noindex');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['strict-transport-security']).toContain('max-age=');
});

test('a short password is refused by the server, not just the browser', async ({
	page,
	request
}) => {
	// The box carries a minlength, but that is a courtesy - anyone can
	// post past it. The refusal that counts is the server's.
	await page.goto('/register');
	const minlength = await page.getByLabel('Password').getAttribute('minlength');
	expect(minlength).toBe('12');

	const res = await request.post('/register?/register', {
		headers: { Origin: new URL(page.url()).origin },
		form: {
			username: `shortpw${Date.now()}`,
			password: 'sevench',
			displayName: 'Short'
		}
	});
	expect(await res.text()).toContain('at least 12 characters');
});

test('the password door waits behind its flap, closed by default', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('With a password')).toBeVisible();
	await expect(page.getByLabel('Username')).not.toBeVisible();
	await openPasswordFlap(page);
	await expect(page.getByLabel('Username')).toBeVisible();
});

test('the home page is a door for the signed-out', async ({ page }) => {
	const response = await page.goto('/home');
	expect(response?.url()).not.toContain('/home');
	await expect(page.getByRole('heading', { name: 'Hang Gang' })).toBeVisible();
});
