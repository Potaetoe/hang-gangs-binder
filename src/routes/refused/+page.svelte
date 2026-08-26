<script lang="ts">
	import { resolve } from '$app/paths';
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
	<title>{page.data.siteName} Binder — Not signed in</title>
</svelte:head>

<main>
	<p class="wordmark">{page.data.siteName}</p>
	<h1>Not signed in</h1>
	<section class="card">
		<p>{message}</p>
		<a class="button" href={resolve('/')}>Back to sign in</a>
	</section>
</main>
