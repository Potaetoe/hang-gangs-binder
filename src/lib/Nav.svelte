<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { active }: { active: 'home' | 'charts' | 'socials' | 'admin' | 'settings' } = $props();
	const isAdmin = $derived(Boolean(page.data.isAdmin));
	const siteName = $derived(String(page.data.siteName ?? 'Hang Gang'));
</script>

<!-- Phone: a fixed bottom rail. Desktop: a top bar wearing the brand.
     Same markup, restyled by the media query in app.css. -->
<nav class="rail">
	<a class="rail-brand" href={resolve('/home')}>
		<p class="rail-brand-name">{siteName}</p>
		<p class="rail-brand-sub">Binder</p>
	</a>
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
		<span>Home</span>
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
		<span>Group Stats</span>
	</a>
	<a
		href={resolve('/socials')}
		class:on={active === 'socials'}
		aria-current={active === 'socials' ? 'page' : undefined}
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
			<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"></path>
			<path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"></path>
		</svg>
		<span>Socials</span>
	</a>
	<a
		href={resolve('/settings')}
		class:on={active === 'settings'}
		aria-current={active === 'settings' ? 'page' : undefined}
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
			<circle cx="12" cy="12" r="3"></circle>
			<path
				d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"
			></path>
		</svg>
		<span>Settings</span>
	</a>
	{#if isAdmin}
		<a
			href={resolve('/admin')}
			class="rail-wide"
			class:on={active === 'admin'}
			aria-current={active === 'admin' ? 'page' : undefined}
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
				<path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z"></path>
				<path d="M9.5 12l2 2 3.5-3.5"></path>
			</svg>
			<span>Admin</span>
		</a>
	{/if}
	<form method="POST" action={resolve('/signout')} class="rail-out rail-wide">
		<button>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
				<path d="M16 17l5-5-5-5"></path>
				<path d="M21 12H9"></path>
			</svg>
			<span>Sign out</span>
		</button>
	</form>
</nav>
