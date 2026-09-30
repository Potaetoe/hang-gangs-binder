/**
 * An event's time is a wall time in the zone the admin picked. Admin
 * pages show it in that zone; members see it in their own clock, which a
 * page script works out from the epoch (static/event-times.js).
 */

/** The start instant in epoch ms. Two Intl passes absorb the zone's
 * offset, daylight saving included. */
export function eventEpoch(date: string, time: string, tz: string): number | null {
	try {
		const [y, mo, d] = date.split('-').map(Number);
		const [h, mi] = time.split(':').map(Number);
		const wall = Date.UTC(y, mo - 1, d, h, mi);
		const format = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		});
		let guess = wall;
		for (let pass = 0; pass < 2; pass++) {
			const parts = Object.fromEntries(
				format.formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)])
			);
			guess += wall - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
		}
		return guess;
	} catch {
		return null;
	}
}

/** "7:30 PM CDT": the wall time with its zone named. */
export function eventTimeLabel(date: string, time: string, tz: string): string {
	const epoch = eventEpoch(date, time, tz);
	if (epoch == null) return time;
	return new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(new Date(epoch));
}
