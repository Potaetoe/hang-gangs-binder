<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in — Hang Gang Binder</title>
</svelte:head>

<main>
	<p class="wordmark">Hang Gang</p>
	<h1>Binder</h1>
	<p class="muted">
		Sign in once — then it is your page to fill in, and everyone's
		numbers to read.
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
				The Telegram door is not set up yet — the operator still
				has to connect the bot. The password door below works.
			</p>
		{/if}
	</section>

	<section class="card">
		<h2>With a password</h2>
		<form method="POST" action="?/signin">
			<label for="username">Username</label>
			<input
				id="username"
				name="username"
				autocomplete="username"
				value={form?.username ?? ''}
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
			New here? <a href="/register">Ask for an account</a> — an admin
			approves it before it works.
		</p>
	</section>
</main>
