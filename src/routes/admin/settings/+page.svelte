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

		<p class="official-title">
			Trend graphs — the ticked fields carry trend lines on home cards, board sparklines, and the
			focused charts. Everything else about a field stays either way.
		</p>
		<fieldset class="picks">
			<legend class="sr-only">Fields with trend graphs</legend>
			{#each data.trendChoices as choice (choice.id)}
				<label class="pick">
					<input type="checkbox" name="trend" value={choice.id} checked={choice.on} />
					<span>{choice.name}</span>
				</label>
			{/each}
		</fieldset>

		<label for="socials-message">The group's panel on the Socials page (HTML)</label>
		<textarea
			id="socials-message"
			name="socials_message"
			rows="10"
			maxlength={data.messageMax}
			spellcheck="false">{data.socialsMessage}</textarea
		>
		<p class="muted">
			Allowed: {data.allowedTags.map((t) => `<${t}>`).join(' ')}. Links must be whole https
			addresses and open in a new tab. Anything else — scripts, images, styles, classes — is removed
			when you save. Leave it empty to hide the panel.
		</p>

		<button>Save settings</button>
	</form>

	{#if data.socialsPreview}
		<div class="card">
			<h3>How the Socials panel reads</h3>
			<!-- Cleaned server-side to the rich.ts allowlist, on save and on load. -->
			<div class="socials-message">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- allowlist-sanitized in rich.ts -->
				{@html data.socialsPreview}
			</div>
		</div>
	{/if}
</section>
