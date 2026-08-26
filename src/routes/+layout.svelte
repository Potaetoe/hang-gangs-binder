<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if data.themeCss}
		<!-- The nonce is what lets THIS block through the CSP - inline
		     styles are otherwise refused (security review finding 7). -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- built from the shipped palette map, never from input -->
		{@html `<style nonce="${data.cspNonce}">${data.themeCss}</style>`}
	{/if}
</svelte:head>

{@render children()}
