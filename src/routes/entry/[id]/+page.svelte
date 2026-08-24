<script lang="ts">
	import { resolve } from '$app/paths';
	import EntryForm from '$lib/EntryForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Correct an entry — Hang Gang Binder</title>
</svelte:head>

<main>
	<p class="wordmark">Hang Gang</p>
	<h1>Entry from {data.dateLabel}</h1>

	<section class="card">
		<EntryForm
			fields={data.formFields}
			raw={form?.raw}
			problems={form?.problems}
			action="?/save"
			submitLabel="Save changes"
		/>
	</section>

	<details class="flap delete-flap">
		<summary>Delete this entry</summary>
		<form method="POST" action="?/delete">
			<p class="muted">It leaves your history for good. Admins keep a record of the deletion.</p>
			<button>Yes, delete it</button>
		</form>
	</details>

	<p><a href={resolve('/home')}>&larr; Back to your page</a></p>
</main>
