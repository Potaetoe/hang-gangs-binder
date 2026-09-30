<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import NonceStyle from '$lib/components/NonceStyle.svelte';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>
<NonceStyle css={data.themeCss} />

{@render children()}
