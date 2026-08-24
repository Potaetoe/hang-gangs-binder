<script lang="ts">
	import { resolve } from '$app/paths';
	import Nav from '$lib/Nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Group Stats — {data.siteName} Binder</title>
</svelte:head>

<Nav active="charts" />
<main class="wide with-rail">
	<div class="page-head">
		<div>
			<p class="wordmark">{data.siteName}</p>
			<h1>Group Stats</h1>
			<p class="muted">
				{data.members === 1 ? '1 member' : `${data.members} members`} &middot; tap a tile for detail and
				filters
			</p>
		</div>
	</div>

	{#if !data.members}
		<p class="muted">No numbers yet — entries make charts.</p>
	{:else}
		<div class="board">
			{#each data.tiles as tile (tile.id)}
				<a class="tile card" href={resolve('/charts/[field]', { field: tile.id })}>
					<p class="tile-name">{tile.name}</p>
					{#if tile.poly}
						<svg viewBox="0 0 140 36" preserveAspectRatio="none" aria-hidden="true">
							<polyline points={tile.poly} />
						</svg>
					{:else if tile.bars.length}
						<div class="tile-bars" aria-hidden="true">
							{#each tile.bars as pct, i (i)}
								<div style={`height: ${pct}%`}></div>
							{/each}
						</div>
					{/if}
					<p class="tile-headline">
						{tile.headline}{#if tile.delta}<span class="tile-delta"> {tile.delta}</span>{/if}
					</p>
				</a>
			{/each}
		</div>
	{/if}
</main>
