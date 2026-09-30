// Show / Hide for a password box, so a typo in an admin's temporary
// passphrase is caught before it locks a member out. Each button names
// its input in data-reveal. Without this script the buttons stay hidden
// and the box stays dots.
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
