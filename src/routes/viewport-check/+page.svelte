<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	// Temporary diagnostic (2026-08-26): the installed app on iOS 26
	// leaves a dead strip under the rail. This page prints where the
	// device thinks its edges are, so a screenshot answers instead of
	// a guess. Remove once the gap is settled.
	const rows: { id: string; label: string }[] = [
		{ id: 'vc-standalone', label: 'navigator.standalone' },
		{ id: 'vc-displaymode', label: 'display-mode: standalone' },
		{ id: 'vc-inner', label: 'window inner (w x h)' },
		{ id: 'vc-screen', label: 'screen (w x h)' },
		{ id: 'vc-visual', label: 'visual viewport height' },
		{ id: 'vc-client', label: 'document height' },
		{ id: 'vc-vh', label: '100vh' },
		{ id: 'vc-dvh', label: '100dvh' },
		{ id: 'vc-svh', label: '100svh' },
		{ id: 'vc-lvh', label: '100lvh' },
		{ id: 'vc-env-top', label: 'safe-area top' },
		{ id: 'vc-env-bottom', label: 'safe-area bottom' },
		{ id: 'vc-gap', label: 'screen minus inner (the gap)' }
	];
</script>

<svelte:head>
	<title>{page.data.siteName} Binder — Screen check</title>
	<script src="/viewport-check.js" defer></script>
</svelte:head>

<main>
	<h1>Screen check</h1>
	<p class="muted">Numbers about this screen, nothing else. Screenshot this page.</p>
	<dl class="vc-list">
		{#each rows as row (row.id)}
			<dt>{row.label}</dt>
			<dd id={row.id}>?</dd>
		{/each}
	</dl>
	<a href={resolve('/settings')}>Back to Settings</a>
</main>
