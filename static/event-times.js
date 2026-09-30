// Shows event times in the viewer's own clock. The server prints each
// event's wall time in its own zone as the fallback; this rewrites it
// from the epoch. When that lands on a different day than the event's
// own, the date comes along, so nobody shows up a day off.
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
