<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { resolve } from '$app/paths';
	import EntryForm from '$lib/EntryForm.svelte';
	import Nav from '$lib/Nav.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Home — {data.siteName} Binder</title>
</svelte:head>

<Nav active="home" />
<main class="wide with-rail">
	<Brand />
	<h1>Hello, {data.name}</h1>
	{#if data.isAdmin}
		<p class="muted">You are signed in as an admin.</p>
	{/if}
	{#if data.pendingCount}
		<a class="card banner" href={resolve('/admin/members')}
			>{data.pendingCount === 1 ? 'Someone is' : `${data.pendingCount} people are`} waiting to be approved</a
		>
	{/if}

	<div class="home-layout">
		<section class="card home-entry">
			<div class="card-head">
				<h2>Add an entry</h2>
				<p class="muted">{data.todayLabel}</p>
			</div>
			<form method="POST" action="?/units" class="units">
				<button
					name="units"
					value="imperial"
					class:on={data.units === 'imperial'}
					aria-pressed={data.units === 'imperial'}>Imperial (US)</button
				>
				<button
					name="units"
					value="metric"
					class:on={data.units === 'metric'}
					aria-pressed={data.units === 'metric'}>Metric</button
				>
			</form>
			<EntryForm
				fields={data.formFields}
				raw={form?.raw}
				problems={form?.problems}
				action="?/entry"
				submitLabel="Save entry"
			/>
		</section>

		<div class="home-rest">
			{#if data.trends.length}
				<section>
					<h2>Trends</h2>
					<div class="trends">
						{#each data.trends as trend (trend.name)}
							<div class="trend card">
								<p class="trend-name">{trend.name}</p>
								<svg
									viewBox="0 0 200 44"
									preserveAspectRatio="none"
									role="img"
									aria-label={trend.name + ' trend'}
								>
									<polyline points={trend.poly} />
								</svg>
								<p class="trend-latest">{trend.latest}</p>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section>
				<h2>Your entries</h2>
				{#if !data.history.length && data.page === 1}
					<p class="muted">No entries yet — the form is where they start.</p>
				{:else}
					<ul class="history">
						{#each data.history as row (row.id)}
							<li class="card">
								<div>
									<p class="muted entry-date">{row.dateLabel}</p>
									<p class="entry-summary">{row.summary || '—'}</p>
								</div>
								<a href={resolve('/entry/[id]', { id: row.id })}>Edit</a>
							</li>
						{/each}
					</ul>
					<nav class="pager">
						{#if data.page > 1}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
							<a href={`${resolve('/home')}?page=${data.page - 1}`}>&larr; Newer</a>
						{/if}
						{#if data.hasOlder}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
							<a class="older" href={`${resolve('/home')}?page=${data.page + 1}`}>Older &rarr;</a>
						{/if}
					</nav>
				{/if}
			</section>
		</div>
	</div>
</main>
