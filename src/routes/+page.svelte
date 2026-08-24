<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in — Hang Gang Binder</title>
</svelte:head>

<main>
	<h1 class="brand-title">Hang Gang</h1>
	<p class="brand-sub">Binder</p>
	<p class="muted">
		Sign in once — then it is your page to fill in, and everyone's numbers to read.
	</p>

	<section class="card">
		<h2>With Telegram</h2>
		{#if data.telegramBot}
			<script
				async
				src="https://telegram.org/js/telegram-widget.js?22"
				data-telegram-login={data.telegramBot}
				data-size="large"
				data-auth-url="/auth/telegram"
				data-request-access="write"
			></script>
		{:else}
			<p class="muted">
				The Telegram door is not set up yet — the operator still has to connect the bot. The
				password door below works.
			</p>
		{/if}
	</section>

	<!-- A door behind a click (the owner's ruling on the first
	     test-drive): Telegram is the main way in, the password form
	     appears on asking. A native disclosure, so it works before any
	     script loads - and it opens itself when a sign-in answer needs
	     showing, or the error would hide behind the closed flap. -->
	<!-- A plain SSR attribute: open when a sign-in answer needs
	     showing, closed otherwise. With csr off nothing ever re-applies
	     it, so the flap belongs to the person after first paint. -->
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
