<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if data.themeCss}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- built from the shipped palette map, never from input -->
		{@html `<style>${data.themeCss}</style>`}
	{/if}
</svelte:head>

{@render children()}
