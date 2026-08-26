// The units toggle rides a ?u= parameter for exactly one page view
// (owner ruling 2026-08-26): the server renders that view, then this
// strips the parameter from the address bar, so a reload or revisit
// falls back to the member's Settings default. The one script the
// member pages carry - the owner lifted the no-script rule for it.
(function () {
	var url = new URL(location.href);
	if (url.searchParams.has('u')) {
		url.searchParams.delete('u');
		history.replaceState(null, '', url);
	}
})();
