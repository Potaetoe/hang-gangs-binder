// The first feature-loop test: the skeleton serves. Every real feature
// adds its own loop here - that is the quality bar (WORKING.md).
import { expect, test } from '@playwright/test';

test('the skeleton serves a page', async ({ page }) => {
	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	await expect(page.locator('h1')).toBeVisible();
});
