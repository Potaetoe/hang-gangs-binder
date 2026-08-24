<script lang="ts">
	import { resolve } from '$app/paths';

	let { active }: { active: 'home' | 'charts' } = $props();
</script>

<!-- Phone: a fixed bottom rail. Desktop: a top bar wearing the brand.
     Same markup, restyled by the media query in app.css. -->
<nav class="rail">
	<div class="rail-brand">
		<p class="rail-brand-name">Hang Gang</p>
		<p class="rail-brand-sub">Binder</p>
	</div>
	<a
		href={resolve('/home')}
		class:on={active === 'home'}
		aria-current={active === 'home' ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="8" r="3.5"></circle>
			<path d="M5 20c1.4-3.6 4-5.4 7-5.4s5.6 1.8 7 5.4"></path>
		</svg>
		<span>Your page</span>
	</a>
	<a
		href={resolve('/charts')}
		class:on={active === 'charts'}
		aria-current={active === 'charts' ? 'page' : undefined}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M4 19h16"></path>
			<path d="M6 19v-6"></path>
			<path d="M11 19v-10"></path>
			<path d="M16 19v-4"></path>
			<path d="M21 19v-8"></path>
		</svg>
		<span>Charts</span>
	</a>
</nav>
