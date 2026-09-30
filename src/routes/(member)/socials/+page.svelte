<script lang="ts">
	import Brand from '$lib/components/Brand.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Nav from '$lib/components/Nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{page.data.siteName} Binder — Socials</title>
</svelte:head>

<Nav active="socials" />
<main class="with-rail">
	<Brand />
	<!-- The highlighted rail item already says where you are. -->
	<h1 class="sr-only">Socials</h1>

	{#if data.mineMissing}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the anchor -->
		<a class="card banner" href={`${resolve('/settings')}#socials`}
			>Add your socials — the gang can't find what isn't listed</a
		>
	{/if}

	{#if data.message}
		<section class="card socials-message">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- cut to an allowlist in socials/message.ts, on save and on render -->
			{@html data.message}
		</section>
	{/if}

	<section>
		<h2>The gang, elsewhere</h2>
		{#if !data.roster.length}
			<p class="muted">Nobody has listed their socials yet — the banner above starts it.</p>
		{:else}
			<ul class="socials-roster card">
				{#each data.roster as row, i (i)}
					<li>
						<p class="roster-name">{row.name}</p>
						<span class="roster-links">
							<!-- eslint-disable svelte/no-navigation-without-resolve -- member links to the outside world -->
							{#each row.links as link (link.key)}
								<a
									class={'social-badge social-' + link.key}
									href={link.href}
									target="_blank"
									rel="noreferrer noopener"
									title={link.name}
									aria-label={`${row.name} on ${link.name}`}>{link.badge}</a
								>
							{/each}
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
