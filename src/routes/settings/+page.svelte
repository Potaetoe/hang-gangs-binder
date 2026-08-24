<script lang="ts">
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
	<p class="wordmark">{page.data.siteName}</p>
	<h1>Settings</h1>
	<p class="muted">Yours, on this device.</p>

	<section class="card">
		<form method="POST" action="?/save">
			<label for="theme">Theme</label>
			<select id="theme" name="theme">
				{#each data.themeChoices as choice (choice)}
					<option value={choice} selected={data.myTheme === choice}
						>{themeNames[choice] ?? choice}</option
					>
				{/each}
			</select>

			<label for="units">Units</label>
			<select id="units" name="units">
				<option value="imperial" selected={data.myUnits === 'imperial'}>Imperial</option>
				<option value="metric" selected={data.myUnits === 'metric'}>Metric</option>
			</select>

			<button>Save</button>
		</form>
	</section>

	<section class="card">
		<h2>Password</h2>
		<p class="muted">Changing it signs out every other session on your account.</p>
		<a class="button" href={resolve('/password')}>Change password</a>
	</section>
</main>
