<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>{data.siteName} Binder — Sign in</title>
</svelte:head>

<main>
	<h1 class="brand-title">{data.siteName}</h1>
	<p class="brand-sub">Binder</p>
	<p class="muted">{data.welcomeText}</p>

	<section class="card">
		<h2>With Telegram</h2>
		{#if data.telegramBot}
			<script
				async
				src="https://telegram.org/js/telegram-widget.js?22"
				data-telegram-login={data.telegramBot}
				data-size="large"
				data-auth-url={`/auth/telegram?state=${data.tgState}`}
				data-request-access="write"
			></script>
		{:else}
			<p class="muted">
				Telegram sign-in is not set up yet — the operator still has to connect the bot. The password
				sign-in below works.
			</p>
		{/if}
	</section>

	<!-- Telegram is the main way in; the password form waits behind a
	     native disclosure. It opens itself when there is an answer to
	     show, or the error would hide behind the closed flap. -->
	<details class="card door-flap" open={form != null}>
		<summary>With a password</summary>
		<form method="POST" action="?/signin">
			<label for="username">Username</label>
			<input
				id="username"
				name="username"
				autocomplete="username"
				{...form?.username ? { value: form.username } : {}}
				required
			/>
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
			{#if form?.message}
				<p class="error">{form.message}</p>
			{/if}
			<button>Sign in</button>
		</form>
		<p class="muted">
			New here? <a href={resolve('/register')}>Ask for an account</a> — an admin approves it before it
			works.
		</p>
	</details>
</main>
