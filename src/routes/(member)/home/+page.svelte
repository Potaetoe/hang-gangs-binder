<script lang="ts">
	import { resolve } from '$app/paths';
	import Brand from '$lib/components/Brand.svelte';
	import EntryForm from '$lib/components/EntryForm.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import EventCard from './EventCard.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Each pager and the month arrows keep the others' places. A month
	// flip sends the events row back to its first page. `u` is the
	// one-view units toggle; a static script strips it after render.
	const homeQuery = (parts: { cal?: string; page?: number; ev?: number; u?: string }) => {
		const cal = parts.cal ?? data.month;
		const page = parts.page ?? data.page;
		const ev = parts.cal ? 1 : (parts.ev ?? data.eventsPager.page);
		let query = `?cal=${cal}`;
		if (ev > 1) query += `&ev=${ev}`;
		if (page > 1) query += `&page=${page}`;
		if (parts.u) query += `&u=${parts.u}`;
		return `${resolve('/home')}${query}`;
	};
</script>

<svelte:head>
	<title>{data.siteName} Binder — Home</title>
	<script src="/units-view.js" defer></script>
	<script src="/event-times.js" defer></script>
</svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- homeQuery() resolves the path; the rule cannot see through the helper -->
<Nav active="home" />
<main class="wide with-rail home-main">
	<Brand />
	<h1>
		Hello, {#if data.isAdmin}<span class="admin-name">{data.name}</span>{:else}{data.name}{/if}
	</h1>
	{#if data.pendingCount}
		<a class="card banner" href={resolve('/admin/members')}
			>{data.pendingCount === 1 ? 'Someone is' : `${data.pendingCount} people are`} waiting to be approved</a
		>
	{/if}
	{#if data.socialsNudge}
		<div class="card banner nudge">
			<a href={`${resolve('/settings')}#socials`}
				>Add your socials — the gang can't find what isn't listed</a
			>
			<form method="POST" action="?/nudgeoff">
				<button class="nudge-off" aria-label="Dismiss">&times;</button>
			</form>
		</div>
	{/if}

	<!-- Three columns on the desktop. The phone reads this top to bottom:
	     events, form, entries, then trends last. -->
	<div class="home-folds">
		<section class="fold-events">
			<h2>Events</h2>
			<div class="card cal-card">
				<div class="cal-head">
					<a
						class="cal-arrow"
						href={homeQuery({ cal: data.calendar.prev })}
						aria-label="Earlier month">&larr;</a
					>
					<p class="cal-label">{data.calendar.label}</p>
					<a
						class="cal-arrow"
						href={homeQuery({ cal: data.calendar.next })}
						aria-label="Later month">&rarr;</a
					>
				</div>
				<table class="cal-table">
					<thead>
						<tr>
							{#each data.calendar.weekdays as day (day)}
								<th scope="col">{day}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.calendar.weeks as week, wi (wi)}
							<tr>
								{#each week as cell, ci (ci)}
									<td>
										{#if cell?.eventId}
											<a
												class="cal-day has-event"
												class:today={cell.today}
												href={`${homeQuery({ ev: cell.eventPage ?? 1 })}#ev-${cell.eventId}`}
												aria-label={`Day ${cell.day}, ${cell.eventCount === 1 ? 'an event' : cell.eventCount + ' events'}`}
												>{cell.day}</a
											>
										{:else if cell}
											<span class="cal-day" class:today={cell.today}>{cell.day}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				{#if form?.rsvpProblem}
					<p class="error">{form.rsvpProblem}</p>
				{/if}
				{#if !data.events.length}
					<p class="muted events-empty">Nothing on the calendar this month.</p>
				{:else}
					<div class="events-row">
						{#each data.events as event (event.id)}
							<EventCard {event} evPage={data.eventsPager.page} page={data.page} />
						{/each}
					</div>
					{#if data.eventsPager.pages > 1}
						<nav class="events-pager">
							{#if data.eventsPager.page > 1}
								<a
									class="cal-arrow"
									href={homeQuery({ ev: data.eventsPager.page - 1 })}
									aria-label="Earlier events">&larr;</a
								>
							{:else}
								<span class="cal-arrow off">&larr;</span>
							{/if}
							<p>{data.eventsPager.from}-{data.eventsPager.to} of {data.eventsPager.total}</p>
							{#if data.eventsPager.page < data.eventsPager.pages}
								<a
									class="cal-arrow"
									href={homeQuery({ ev: data.eventsPager.page + 1 })}
									aria-label="Later events">&rarr;</a
								>
							{:else}
								<span class="cal-arrow off">&rarr;</span>
							{/if}
						</nav>
					{/if}
				{/if}
			</div>
		</section>

		<section class="fold-entry">
			<!-- No date in the heading: the calendar already says what day it is. -->
			<h2>Add your current information</h2>
			<div class="card home-entry">
				<nav class="units">
					<a
						href={homeQuery({ u: 'imperial' })}
						class:on={data.units === 'imperial'}
						aria-current={data.units === 'imperial'}>Imperial (US)</a
					>
					<a
						href={homeQuery({ u: 'metric' })}
						class:on={data.units === 'metric'}
						aria-current={data.units === 'metric'}>Metric</a
					>
				</nav>
				<EntryForm
					fields={data.formFields}
					units={data.units}
					raw={form?.raw}
					problems={form?.problems}
					action="?/entry"
					submitLabel="Save entry"
				/>
			</div>
		</section>

		<section class="fold-entries">
			<h2>Your entries</h2>
			{#if !data.entryTable.rows.length && data.page === 1}
				<p class="muted">No entries yet — the form is where they start.</p>
			{:else}
				<div class="table-scroll entries-scroll card">
					<table class="admin-table entries-table">
						<thead>
							<tr>
								<th>Date</th>
								{#each data.entryTable.columns as column (column)}
									<th>{column}</th>
								{/each}
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each data.entryTable.rows as row (row.id)}
								<tr>
									<td class="entry-date-cell">{row.dateLabel}</td>
									{#each row.cells as cell, i (i)}
										<td>{cell || '—'}</td>
									{/each}
									<td><a href={resolve('/(member)/entry/[id]', { id: row.id })}>Edit</a></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<nav class="pager">
					{#if data.page > 1}
						<a href={homeQuery({ page: data.page - 1 })}>&larr; Newer</a>
					{/if}
					{#if data.hasOlder}
						<a class="older" href={homeQuery({ page: data.page + 1 })}>Older &rarr;</a>
					{/if}
				</nav>
			{/if}
		</section>

		{#if data.trends.length}
			<section class="fold-trends">
				<h2>Your trends</h2>
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
	</div>
</main>
