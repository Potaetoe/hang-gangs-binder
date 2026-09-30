<script lang="ts">
	import { page } from '$app/state';

	/**
	 * A style element the CSP lets through. The policy refuses inline
	 * style attributes, so anything sized per request (the palette, chart
	 * bars) goes here, stamped with the request's nonce. The CSS must be
	 * built from shipped values and server numbers, never from input.
	 */
	let { css }: { css: string } = $props();
</script>

<svelte:head>
	{#if css}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- built from shipped values and server numbers, never from input -->
		{@html `<style nonce="${page.data.cspNonce}">${css}</style>`}
	{/if}
</svelte:head>
