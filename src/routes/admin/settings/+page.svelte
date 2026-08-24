<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const themeNames: Record<string, string> = {
		auto: 'Follow the device (daylight / midnight)',
		midnight: 'Midnight',
		daylight: 'Daylight',
		plum: 'Plum',
		meadow: 'Meadow'
	};
</script>

<section>
	<h2>Settings</h2>
	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}
	{#if form?.done}
		<p class="muted done">{form.done}</p>
	{/if}
	<form method="POST" action="?/save" class="card settings-form">
		<label for="site-name">Site name</label>
		<input id="site-name" name="site_name" value={data.settings.siteName} />

		<label for="welcome-text">Welcome text on the sign-in page</label>
		<textarea id="welcome-text" name="welcome_text" rows="3">{data.settings.welcomeText}</textarea>

		<label for="timezone">Timezone (dates entries by it)</label>
		<select id="timezone" name="timezone">
			{#if !data.timezoneChoices.some((z) => z.id === data.settings.timezone)}
				<option value={data.settings.timezone} selected>{data.settings.timezone}</option>
			{/if}
			{#each data.timezoneChoices as zone (zone.id)}
				<option value={zone.id} selected={data.settings.timezone === zone.id}>{zone.name}</option>
			{/each}
		</select>

		<label for="theme">Default theme (each member can pick their own in Settings)</label>
		<select id="theme" name="theme">
			{#each data.themeChoices as choice (choice)}
				<option value={choice} selected={data.settings.theme === choice}
					>{themeNames[choice] ?? choice}</option
				>
			{/each}
		</select>

		<button>Save settings</button>
	</form>
</section>
