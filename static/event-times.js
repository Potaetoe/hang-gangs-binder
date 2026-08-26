// Event times land in the viewer's own clock (owner ruling
// 2026-08-26): the server prints the event's wall time in its own
// zone as a fallback, and this rewrites each one from its epoch into
// the browser's timezone. When the conversion crosses into a
// different calendar day than the event's own, the date comes along
// so nobody shows up a day off.
(function () {
	var nodes = document.querySelectorAll('[data-epoch]');
	for (var i = 0; i < nodes.length; i++) {
		var ms = Number(nodes[i].getAttribute('data-epoch'));
		if (!isFinite(ms)) continue;
		try {
			var when = new Date(ms);
			var pad = function (n) {
				return (n < 10 ? '0' : '') + n;
			};
			var localDay =
				when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
			var opts = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
			if (nodes[i].getAttribute('data-date') !== localDay) {
				opts.month = 'short';
				opts.day = 'numeric';
			}
			nodes[i].textContent = new Intl.DateTimeFormat(undefined, opts).format(when);
		} catch {
			/* the zone-labelled fallback stays */
		}
	}
})();
