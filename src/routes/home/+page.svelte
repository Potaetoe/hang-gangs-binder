<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { resolve } from '$app/paths';
	import EntryForm from '$lib/EntryForm.svelte';
	import EventGallery from '$lib/EventGallery.svelte';
	import Nav from '$lib/Nav.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The pager and the month arrows each keep the other's place. Both
	// values are the server's own strings, never a person's.
	const homeQuery = (parts: { cal?: string; page?: number }) => {
		const cal = parts.cal ?? data.month;
		const page = parts.page ?? data.page;
		return `?cal=${cal}${page > 1 ? `&page=${page}` : ''}`;
	};
</script>

<svelte:head>
	<title>Home — {data.siteName} Binder</title>
</svelte:head>

<Nav active="home" />
<main class="wide with-rail home-main">
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

	<!-- The tri-fold (owner ruling 2026-08-26): three desktop columns -
	     the calendar, the form, trends over the entries. The phone reads
	     the same pieces top to bottom in the ruled order. -->
	<div class="home-folds">
		{#if data.trends.length}
			<section class="fold-trends">
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

		<section class="fold-events">
			<h2>Events</h2>
			<div class="card cal-card">
				<div class="cal-head">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
					<a
						class="cal-arrow"
						href={`${resolve('/home')}${homeQuery({ cal: data.calendar.prev })}`}
						aria-label="Earlier month">&larr;</a
					>
					<p class="cal-label">{data.calendar.label}</p>
					<a
						class="cal-arrow"
						href={`${resolve('/home')}${homeQuery({ cal: data.calendar.next })}`}
						aria-label="Later month">&rarr;</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
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
										{#if cell}
											{#if cell.eventId}
												<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a same-page anchor down to the event -->
												<a
													class="cal-day has-event"
													class:today={cell.today}
													href={`#ev-${cell.eventId}`}
													aria-label={`Day ${cell.day}, ${cell.eventCount === 1 ? 'an event' : cell.eventCount + ' events'}`}
													>{cell.day}</a
												>
											{:else}
												<span class="cal-day" class:today={cell.today}>{cell.day}</span>
											{/if}
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="cal-events">
					{#if !data.events.length}
						<p class="muted">Nothing on the calendar this month.</p>
					{:else}
						{#each data.events as event (event.id)}
							<article class="event" id={'ev-' + event.id}>
								<p class="muted event-date">{event.dateLabel}</p>
								<h3 class="event-title">{event.title}</h3>
								{#if event.place}
									<p class="event-place">{event.place}</p>
								{/if}
								{#if event.notes}
									<p class="event-notes">{event.notes}</p>
								{/if}
								{#if event.imageIds.length}
									<EventGallery
										imageIds={event.imageIds}
										title={event.title}
										returnTo={'ev-' + event.id}
									/>
								{/if}
							</article>
						{/each}
					{/if}
				</div>
			</div>
		</section>

		<section class="fold-entry">
			<!-- The heading stands outside the card like its neighbours,
			     and carries no date - the calendar already says what day
			     it is (owner corrections on the drive, 2026-08-26). -->
			<h2>Add an entry</h2>
			<div class="card home-entry">
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
			</div>
		</section>

		<section class="fold-entries">
			<h2>Your entries</h2>
			{#if !data.entryTable.rows.length && data.page === 1}
				<p class="muted">No entries yet — the form is where they start.</p>
			{:else}
				<div class="table-scroll card">
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
									<td><a href={resolve('/entry/[id]', { id: row.id })}>Edit</a></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<nav class="pager">
					{#if data.page > 1}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
						<a href={`${resolve('/home')}${homeQuery({ page: data.page - 1 })}`}>&larr; Newer</a>
					{/if}
					{#if data.hasOlder}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
						<a class="older" href={`${resolve('/home')}${homeQuery({ page: data.page + 1 })}`}
							>Older &rarr;</a
						>
					{/if}
				</nav>
			{/if}
		</section>
	</div>
</main>
