// The units toggle carries ?u= for exactly one page view. The server has
// already rendered that view, so this strips the parameter from the
// address bar, and a reload falls back to the member's Settings default.
(function () {
	var url = new URL(location.href);
	if (url.searchParams.has('u')) {
		url.searchParams.delete('u');
		history.replaceState(null, '', url);
	}
})();
