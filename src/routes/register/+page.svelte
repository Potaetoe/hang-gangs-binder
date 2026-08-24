<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Ask for an account — {page.data.siteName} Binder</title>
</svelte:head>

<main>
	<p class="wordmark">{page.data.siteName}</p>
	<h1>Ask for an account</h1>

	{#if form?.registered}
		<section class="card">
			<h2>Asked.</h2>
			<p>
				An admin has to approve your account before it works. Once they have, sign in with the
				username and password you just chose.
			</p>
			<a class="button" href={resolve('/')}>Back to the door</a>
		</section>
	{:else}
		<section class="card">
			<form method="POST" action="?/register">
				<label for="username">Username</label>
				<input
					id="username"
					name="username"
					autocomplete="username"
					{...form?.username ? { value: form.username } : {}}
					required
				/>
				<label for="displayName">Name to show (optional)</label>
				<input
					id="displayName"
					name="displayName"
					autocomplete="nickname"
					{...form?.displayName ? { value: form.displayName } : {}}
				/>
				<label for="password">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
				/>
				{#if form?.message}
					<p class="error">{form.message}</p>
				{/if}
				<button>Ask for the account</button>
			</form>
			<p class="muted"><a href={resolve('/')}>Back to the door</a></p>
		</section>
	{/if}
</main>
