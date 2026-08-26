<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Nav from '$lib/Nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{page.data.siteName} Binder — Socials</title>
</svelte:head>

<Nav active="socials" />
<main class="with-rail">
	<Brand />
	<!-- The rail already says where you are (owner ruling 2026-08-26);
	     the heading stays for screen readers only. -->
	<h1 class="sr-only">Socials</h1>

	{#if data.mineMissing}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the anchor -->
		<a class="card banner" href={`${resolve('/settings')}#socials`}
			>Add your socials — the gang can't find what isn't listed</a
		>
	{/if}

	{#if data.official.length}
		<section class="official card">
			<h2>The group's own</h2>
			<ul class="official-list">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- admin-entered https links to the outside world -->
				{#each data.official as link (link.label)}
					<li>
						<a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a>
					</li>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</ul>
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
