<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Nav from '$lib/Nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const themeNames: Record<string, string> = {
		'': 'Site default',
		midnight: 'Midnight',
		daylight: 'Daylight',
		plum: 'Plum',
		meadow: 'Meadow'
	};
</script>

<svelte:head>
	<title>Settings — {page.data.siteName} Binder</title>
</svelte:head>

<Nav active="settings" />
<main class="with-rail">
	<Brand />
	<h1>Settings</h1>
	<p class="muted">Yours, on this device. A tap saves it.</p>

	<div class="settings-list">
		<section class="setting">
			<h2>Name to show</h2>
			<form method="POST" action="?/name" class="name-row">
				<label class="sr-only" for="display-name">Name to show</label>
				<input id="display-name" name="display_name" autocomplete="off" value={data.myName} />
				<button>Save name</button>
			</form>
		</section>

		<section class="setting">
			<h2>Theme</h2>
			<form method="POST" action="?/theme" class="units wrap">
				{#each data.themeChoices as choice (choice)}
					<button
						name="theme"
						value={choice}
						class:on={data.myTheme === choice}
						aria-pressed={data.myTheme === choice}>{themeNames[choice] ?? choice}</button
					>
				{/each}
			</form>
		</section>

		<section class="setting">
			<h2>Units</h2>
			<form method="POST" action="?/units" class="units">
				<button
					name="units"
					value="imperial"
					class:on={data.myUnits === 'imperial'}
					aria-pressed={data.myUnits === 'imperial'}>Imperial (US)</button
				>
				<button
					name="units"
					value="metric"
					class:on={data.myUnits === 'metric'}
					aria-pressed={data.myUnits === 'metric'}>Metric</button
				>
			</form>
		</section>

		{#if data.hasPasswordDoor}
			<section class="setting">
				<h2>Password</h2>
				<p class="muted">Changing it signs out every other session on your account.</p>
				<a class="button" href={resolve('/password')}>Change password</a>
			</section>
		{/if}
	</div>
</main>
