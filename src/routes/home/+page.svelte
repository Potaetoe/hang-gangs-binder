<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Your page — Hang Gang Binder</title>
</svelte:head>

<main>
	<p class="wordmark">Hang Gang</p>
	<h1>Hello, {data.name}</h1>
	<section class="card">
		<p>
			You are signed in{data.isAdmin ? ' as an admin' : ''}. Your page - entries, history and the
			group's charts - is the next feature to arrive here.
		</p>
		<form method="POST" action="?/signout">
			<button>Sign out</button>
		</form>
	</section>
</main>
