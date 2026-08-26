// The screen-check page's tape measure (temporary diagnostic,
// 2026-08-26): where does this device think the page ends? Reads
// only geometry - no member data, nothing leaves the device.
(function () {
	function probe(height) {
		var el = document.createElement('div');
		el.style.cssText =
			'position:absolute;left:-9999px;top:0;width:10px;visibility:hidden;height:' + height;
		document.body.appendChild(el);
		var size = el.offsetHeight;
		el.remove();
		return size;
	}
	function envProbe(name) {
		var el = document.createElement('div');
		el.style.cssText =
			'position:absolute;left:-9999px;top:0;width:10px;visibility:hidden;' +
			'height:env(' + name + ', 0px)';
		document.body.appendChild(el);
		var size = el.offsetHeight;
		el.remove();
		return size;
	}
	function put(id, value) {
		var el = document.getElementById(id);
		if (el) el.textContent = String(value);
	}
	function read() {
		put('vc-standalone', 'standalone' in navigator ? navigator.standalone : 'n/a');
		put('vc-displaymode', matchMedia('(display-mode: standalone)').matches);
		put('vc-inner', window.innerWidth + ' x ' + window.innerHeight);
		put('vc-screen', screen.width + ' x ' + screen.height);
		put('vc-visual', window.visualViewport ? Math.round(window.visualViewport.height) : 'n/a');
		put('vc-client', document.documentElement.clientHeight);
		put('vc-vh', probe('100vh'));
		put('vc-dvh', probe('100dvh'));
		put('vc-svh', probe('100svh'));
		put('vc-lvh', probe('100lvh'));
		put('vc-env-top', envProbe('safe-area-inset-top'));
		put('vc-env-bottom', envProbe('safe-area-inset-bottom'));
		put('vc-gap', screen.height - window.innerHeight);
	}
	read();
	window.addEventListener('resize', read);
})();
