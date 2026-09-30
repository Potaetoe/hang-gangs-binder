// The calendar and events feature (DESIGN.md feature 5), walked the way people use it: an admin puts an event on
// the calendar, and every member's home page shows it - grid, list,
// and gallery - with no code change anywhere.
import { expect, test } from '@playwright/test';
import { fillStable, register, signIn, signOut } from './helpers';

// A London clock, so the timed-event checks PROVE the conversion ran:
// 7 PM Central is past midnight there, and the fallback label (7:00
// PM CDT) cannot be mistaken for the converted one.
test.use({ timezoneId: 'Europe/London' });

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

	// The admin fills the whole card: day, place, notes, four images.
	await signIn(page, boss);
	await page.goto('/admin/events');
	await fillStable(page, /what is happening/i, title);
	await fillStable(page, 'The day', '2031-05-15');
	// 7 PM in the preselected site zone (US Central) - the admin picks
	// the zone, nothing is assumed.
	await fillStable(page, /^time/i, '19:00');
	await fillStable(page, /where/i, 'The park');
	await fillStable(page, /notes/i, 'Bring a chair.');
	await page
		.getByLabel(/^images/i)
		.setInputFiles(
			[1, 2, 3, 4].map((n) => ({ name: `flyer${n}.png`, mimeType: 'image/png', buffer: PNG }))
		);
	await page.getByRole('button', { name: 'Add the event' }).click();

	// The add lands on the event's own page, all four images stored.
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await expect(page.locator('.gallery img')).toHaveCount(4);

	// The list page carries the new row, time in ITS zone (CDT in May).
	await page.goto('/admin/events');
	const row = page.locator('.admin-table tbody tr').filter({ hasText: title });
	await expect(row).toBeVisible();
	await expect(row).toContainText('The park');
	await expect(row).toContainText('7:00 PM CDT');
	await signOut(page);

	// No code changed. The member's calendar knows the day, the list
	// tells the story, the images arrive.
	await signIn(page, member);
	await page.goto('/home?cal=2031-05');
	await expect(page.locator('.cal-label')).toHaveText('May 2031');
	await expect(page.locator('a.cal-day.has-event', { hasText: '15' })).toBeVisible();
	const event = page.locator('.event').filter({ hasText: title });
	await expect(event).toBeVisible();
	await expect(event).toContainText('The park');
	await expect(event).toContainText('Bring a chair.');

	// The time rides as an instant: 7 PM Central on May 15 2031 is
	// midnight UTC on the 16th - 1 AM in this browser's London clock,
	// a day past the event's own date, so the script shows the date
	// too. Seeing May 16 proves the conversion actually ran.
	const timeSpan = event.locator('[data-epoch]');
	await expect(timeSpan).toHaveAttribute('data-epoch', String(Date.UTC(2031, 4, 16)));
	await expect(timeSpan).toContainText('May 16');
	await expect(timeSpan).toContainText('1:00');
	// Three thumbnails; the fourth folds into the "+1 more" tile.
	await expect(event.locator('.gallery img')).toHaveCount(3);
	await expect(event.locator('.gallery-more')).toHaveText('+1 more');
	const imgSrc = await event.locator('.gallery img').first().getAttribute('src');
	expect(imgSrc).toBeTruthy();
	const img = await page.request.get(imgSrc!);
	expect(img.ok()).toBeTruthy();
	expect(img.headers()['content-type']).toBe('image/png');

	// The desktop home is three columns: calendar, form, entries, left
	// to right.
	const entryBox = await page.locator('.fold-entry').boundingBox();
	const eventsBox = await page.locator('.fold-events').boundingBox();
	const entriesBox = await page.locator('.fold-entries').boundingBox();
	expect(entryBox!.x).toBeGreaterThan(eventsBox!.x);
	expect(entriesBox!.x).toBeGreaterThan(entryBox!.x);

	// A tapped image opens the preview overlay; the arrows walk the
	// gallery; the close puts it away.
	await event.locator('.gallery a').first().click();
	await expect(page.locator('.lightbox:visible')).toContainText('1 of 4');
	await page.locator('.lightbox:visible').getByLabel('Next image').click();
	await expect(page.locator('.lightbox:visible')).toContainText('2 of 4');
	await page.locator('.lightbox:visible').getByLabel('Previous image').click();
	await expect(page.locator('.lightbox:visible')).toContainText('1 of 4');
	await page.locator('.lightbox:visible .lightbox-x').click();
	await expect(page.locator('.lightbox:visible')).toHaveCount(0);

	// The "+1 more" tile opens the preview at the first hidden image.
	await event.locator('.gallery-more').click();
	await expect(page.locator('.lightbox:visible')).toContainText('4 of 4');
	await page.locator('.lightbox:visible .lightbox-x').click();
	await expect(page.locator('.lightbox:visible')).toHaveCount(0);

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

test('the events row shows three at a time, and the days know their page', async ({ page }) => {
	const stamp = Date.now();
	const boss = `pager${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();

	// Four events in one month - one more than a page holds.
	await signIn(page, boss);
	for (let day = 1; day <= 4; day++) {
		await page.goto('/admin/events');
		await fillStable(page, /what is happening/i, `Night ${day} ${stamp}`);
		await fillStable(page, 'The day', `2031-03-0${day}`);
		await page.getByRole('button', { name: 'Add the event' }).click();
		await expect(page.getByRole('heading', { name: `Night ${day} ${stamp}` })).toBeVisible();
	}

	// Page one: three cards and the count.
	await page.goto('/home?cal=2031-03');
	await expect(page.locator('.event')).toHaveCount(3);
	await expect(page.locator('.events-pager')).toContainText('1-3 of 4');

	// The pager reaches the fourth.
	await page.getByLabel('Later events').click();
	await expect(page.locator('.event')).toHaveCount(1);
	await expect(page.locator('.event')).toContainText(`Night 4 ${stamp}`);
	await expect(page.locator('.events-pager')).toContainText('4-4 of 4');

	// A day on the grid links straight to the page its event is on.
	const day4 = page.locator('a.cal-day.has-event', { hasText: '4' });
	expect(await day4.getAttribute('href')).toContain('ev=2');
});

test('members tap interested, see only the count, and the admin sees who', async ({ page }) => {
	// RSVP: one "interested" toggle, a count
	// for members, names on the admin event page, and the admin picks
	// the last day it is open.
	// Three accounts and many sign-ins: ~11s alone, past the 30s budget
	// when the whole suite shares a laptop.
	test.slow();
	const stamp = Date.now();
	const boss = `host${stamp}`;
	const first = `keen${stamp}`;
	const second = `maybe${stamp}`;
	const open = `Picnic ${stamp}`;
	const shut = `Gala ${stamp}`;
	await register(page, boss);
	expect((await page.request.post(`/test/admin?username=${boss}`)).ok()).toBeTruthy();
	for (const who of [first, second]) {
		await register(page, who);
		expect((await page.request.post(`/test/approve?username=${who}`)).ok()).toBeTruthy();
	}

	// Two events: one open (blank close day = through its own day), one
	// the admin already closed with a past day.
	await signIn(page, boss);
	for (const [title, day, until] of [
		[open, '2035-06-10', ''],
		[shut, '2035-06-12', '2020-01-01']
	]) {
		await page.goto('/admin/events');
		await fillStable(page, /what is happening/i, title);
		await fillStable(page, 'The day', day);
		if (until) await fillStable(page, /rsvp open through/i, until);
		await page.getByRole('button', { name: 'Add the event' }).click();
		await expect(page.getByRole('heading', { name: title })).toBeVisible();
	}
	await signOut(page);

	const card = (title: string) => page.locator('article.event').filter({ hasText: title });

	// The first member: nobody yet, taps in, and is counted.
	await signIn(page, first);
	await page.goto('/home?cal=2035-06');
	await expect(card(open).locator('.rsvp-count')).toHaveText('No one yet');
	await card(open).getByRole('button', { name: "I'm interested" }).click();
	await expect(card(open).locator('.rsvp-count')).toHaveText('1 interested · including you');
	await expect(card(open).getByRole('button', { name: 'Interested ✓' })).toBeVisible();
	// The redirect lands back on the same month and card.
	await expect(page).toHaveURL(/cal=2035-06.*#ev-/);

	// The closed one offers no button - and a hand-made POST is refused.
	await expect(card(shut).getByText('RSVP closed')).toBeVisible();
	await expect(card(shut).getByRole('button')).toHaveCount(0);
	const shutId = (await card(shut).getAttribute('id'))!.slice(3);
	const forced = await page.request.post('/home?/rsvp', {
		form: { event: shutId, on: '1' },
		// A browser's own no-script form post: same origin, wants HTML.
		headers: { origin: new URL(page.url()).origin, accept: 'text/html' }
	});
	expect(forced.status()).toBe(400);
	await page.goto('/home?cal=2035-06');
	await expect(card(shut).locator('.rsvp-count')).toHaveText('No one was interested');
	await signOut(page);

	// The second member sees the count, never the name; in, then out.
	await signIn(page, second);
	await page.goto('/home?cal=2035-06');
	await expect(card(open).locator('.rsvp-count')).toHaveText('1 interested');
	await expect(card(open).getByText(first)).toHaveCount(0);
	await card(open).getByRole('button', { name: "I'm interested" }).click();
	await expect(card(open).locator('.rsvp-count')).toHaveText('2 interested · including you');
	await card(open).getByRole('button', { name: 'Interested ✓' }).click();
	await expect(card(open).locator('.rsvp-count')).toHaveText('1 interested');
	await signOut(page);

	// The admin: the count in the list, the name on the event page.
	await signIn(page, boss);
	await page.goto('/admin/events');
	const row = page.locator('.admin-table tbody tr').filter({ hasText: open });
	await expect(row.locator('td').nth(5)).toHaveText('1');
	await row.getByRole('link', { name: 'Open' }).click();
	const who = page.locator('#interested');
	await expect(who.getByRole('heading', { name: 'Interested (1)' })).toBeVisible();
	await expect(who.getByRole('link', { name: first })).toBeVisible();
	await expect(who.getByText(second)).toHaveCount(0);

	// Closing early: a past close day shuts it, and the count stays.
	await fillStable(page, /rsvp open through/i, '2020-01-01');
	await page.getByRole('button', { name: 'Save the event' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	await expect(who.getByText(/RSVP closed after/)).toBeVisible();
	await signOut(page);
	await signIn(page, first);
	await page.goto('/home?cal=2035-06');
	await expect(card(open).getByText('RSVP closed')).toBeVisible();
	await expect(card(open).locator('.rsvp-count')).toHaveText('1 interested · including you');
	await expect(card(open).getByRole('button')).toHaveCount(0);
});
