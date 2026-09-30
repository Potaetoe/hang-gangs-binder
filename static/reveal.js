// Show / Hide for a password box (owner ask 2026-09-29): the admin's
// temporary passphrase types as dots, and one tap shows it so a typo
// gets caught before it locks a member out. Each button names its
// input in data-reveal; without this script the buttons stay hidden
// and the box simply stays dots.
(function () {
	var buttons = document.querySelectorAll('[data-reveal]');
	for (var i = 0; i < buttons.length; i++) {
		(function (button) {
			var input = document.getElementById(button.getAttribute('data-reveal'));
			if (!input) return;
			button.hidden = false;
			button.setAttribute('aria-pressed', 'false');
			button.addEventListener('click', function () {
				var show = input.type === 'password';
				input.type = show ? 'text' : 'password';
				button.textContent = show ? 'Hide' : 'Show';
				button.setAttribute('aria-pressed', show ? 'true' : 'false');
				input.focus();
			});
		})(buttons[i]);
	}
})();
