/**
 * Calendar days as ISO strings. The binder stores days, not clock
 * times, anywhere a member is involved (DESIGN.md, privacy model).
 */

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in UTC, for plumbing rows no one reads as a date. */
export const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** Today on the site's calendar. The group dates everything in one zone. */
export function dayIn(timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

/** "Mar 4, 2026". Read in UTC so the stored day never shifts. */
export function formatDay(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Right shape and a real day: 2026-02-31 fails. */
export function validDay(date: string): boolean {
	if (!DAY_SHAPE.test(date)) return false;
	const [y, m, d] = date.split('-').map(Number);
	const utc = new Date(Date.UTC(y, m - 1, d));
	return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

export function validTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Seconds since the epoch, for expiries that must be enforced. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
