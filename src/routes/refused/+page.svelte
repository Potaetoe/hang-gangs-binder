<script lang="ts">
	import { page } from '$app/state';

	const why = $derived(page.url.searchParams.get('why'));
	const message = $derived(
		why === 'not-a-member'
			? 'This binder is for members of the group. Your Telegram account is not in it.'
			: why === 'bad-signature'
				? 'That sign-in could not be verified. Go back and try again.'
				: 'Telegram could not be reached to check membership. Try again in a minute.'
	);
</script>

<svelte:head>
	<title>Not signed in — Hang Gang Binder</title>
</svelte:head>

<main>
	<p class="wordmark">Hang Gang</p>
	<h1>Not signed in</h1>
	<section class="card">
		<p>{message}</p>
		<a class="button" href="/">Back to the door</a>
	</section>
</main>
