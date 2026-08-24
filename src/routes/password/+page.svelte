<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>New password — {page.data.siteName} Binder</title>
</svelte:head>

<main>
	<Brand />
	<h1>New password</h1>
	{#if data.forced}
		<p class="muted">
			An admin let you in with a temporary passphrase. Pick your own password before going further.
		</p>
	{/if}

	<section class="card">
		{#if form?.message}
			<p class="error">{form.message}</p>
		{/if}
		<form method="POST" action="?/change">
			<label for="current">{data.forced ? 'The temporary passphrase' : 'Current password'}</label>
			<input id="current" name="current" type="password" autocomplete="current-password" />
			<label for="next">New password</label>
			<input id="next" name="next" type="password" autocomplete="new-password" />
			<button>Save password</button>
		</form>
		<p class="muted">Saving signs out every other session on this account.</p>
	</section>
</main>
