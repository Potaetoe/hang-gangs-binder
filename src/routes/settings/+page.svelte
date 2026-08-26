<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Nav from '$lib/Nav.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const themeNames: Record<string, string> = {
		'': 'Site default',
		midnight: 'Midnight',
		daylight: 'Daylight',
		plum: 'Plum',
		meadow: 'Meadow'
	};
</script>

<svelte:head>
	<title>{page.data.siteName} Binder — Settings</title>
</svelte:head>

<Nav active="settings" />
<main class="with-rail">
	<Brand />
	<!-- The rail already says where you are (owner ruling 2026-08-26);
	     the heading stays for screen readers only. -->
	<h1 class="sr-only">Settings</h1>

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

		<section class="setting" id="socials">
			<h2>Your socials</h2>
			<p class="muted">
				What the Socials page lists under your name. Sealed like your name — a leaked database shows
				none of it. Clearing every box takes you off the roster.
			</p>
			{#if form?.socialsProblems}
				<ul class="error problems">
					{#each form.socialsProblems as problem (problem)}
						<li>{problem}</li>
					{/each}
				</ul>
			{/if}
			{#if form?.socialsSaved}
				<p class="muted done">Saved.</p>
			{/if}
			<form method="POST" action="?/socials">
				<label for="s-x">X handle</label>
				<input
					id="s-x"
					name="s_x"
					autocomplete="off"
					placeholder="@handle"
					value={data.mySocials.x ?? ''}
				/>
				<label for="s-tumblr">Tumblr handle</label>
				<input
					id="s-tumblr"
					name="s_tumblr"
					autocomplete="off"
					placeholder="@blog"
					value={data.mySocials.tumblr ?? ''}
				/>
				<label for="s-feabie">Feabie profile link</label>
				<input
					id="s-feabie"
					name="s_feabie"
					autocomplete="off"
					placeholder="https://www.feabie.com/…"
					value={data.mySocials.feabie ?? ''}
				/>
				<label for="s-fetlife">FetLife profile link</label>
				<input
					id="s-fetlife"
					name="s_fetlife"
					autocomplete="off"
					placeholder="https://fetlife.com/users/…"
					value={data.mySocials.fetlife ?? ''}
				/>
				<label for="s-other-label">Something else — name it</label>
				<input
					id="s-other-label"
					name="s_other_label"
					autocomplete="off"
					maxlength="24"
					placeholder="Bluesky, Discord, …"
					value={data.mySocials.other?.label ?? ''}
				/>
				<label for="s-other-url">…and its link</label>
				<input
					id="s-other-url"
					name="s_other_url"
					autocomplete="off"
					placeholder="https://…"
					value={data.mySocials.other?.url ?? ''}
				/>
				<button>Save socials</button>
			</form>
		</section>

		{#if data.hasPasswordDoor}
			<section class="setting">
				<h2>Password</h2>
				<p class="muted">Changing it signs out every other session on your account.</p>
				<a class="button" href={resolve('/password')}>Change password</a>
			</section>
		{/if}

		<!-- The phone rail runs four stops (owner ruling 2026-08-26);
		     signing out lives here instead. -->
		<section class="setting">
			<h2>Sign out</h2>
			<form method="POST" action={resolve('/signout')}>
				<button class="quiet">Sign out on this device</button>
			</form>
		</section>
	</div>
</main>
