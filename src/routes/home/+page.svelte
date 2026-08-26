<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { resolve } from '$app/paths';
	import EntryForm from '$lib/EntryForm.svelte';
	import EventGallery from '$lib/EventGallery.svelte';
	import Nav from '$lib/Nav.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The pagers and the month arrows each keep the others' places.
	// Every value is the server's own string, never a person's. A month
	// flip hands the events row back to its first page. `u` is the
	// one-page-view units toggle (owner ruling 2026-08-26) - only the
	// toggle links set it, and a static script strips it after render.
	const homeQuery = (parts: { cal?: string; page?: number; ev?: number; u?: string }) => {
		const cal = parts.cal ?? data.month;
		const page = parts.page ?? data.page;
		const ev = parts.cal ? 1 : (parts.ev ?? data.eventsPager.page);
		let query = `?cal=${cal}`;
		if (ev > 1) query += `&ev=${ev}`;
		if (page > 1) query += `&page=${page}`;
		if (parts.u) query += `&u=${parts.u}`;
		return query;
	};
</script>

<svelte:head>
	<title>{data.siteName} Binder — Home</title>
	<script src="/units-view.js" defer></script>
	<script src="/event-times.js" defer></script>
</svelte:head>

<Nav active="home" />
<main class="wide with-rail home-main">
	<Brand />
	<!-- An admin's name wears the accent instead of a tagline saying so
	     (owner ruling 2026-08-26). -->
	<h1>
		Hello, {#if data.isAdmin}<span class="admin-name">{data.name}</span>{:else}{data.name}{/if}
	</h1>
	{#if data.pendingCount}
		<a class="card banner" href={resolve('/admin/members')}
			>{data.pendingCount === 1 ? 'Someone is' : `${data.pendingCount} people are`} waiting to be approved</a
		>
	{/if}

	<!-- The tri-fold (owner ruling 2026-08-26): three desktop columns -
	     the calendar, the form, trends over the entries. The phone reads
	     this DOM top to bottom: events, form, trends, entries (owner
	     correction on the drive). -->
	<div class="home-folds">
		<section class="fold-events">
			<h2>Events</h2>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query strings -->
			<div class="card cal-card">
				<div class="cal-head">
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
												<a
													class="cal-day has-event"
													class:today={cell.today}
													href={`${resolve('/home')}${homeQuery({ ev: cell.eventPage ?? 1 })}#ev-${cell.eventId}`}
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
				{#if !data.events.length}
					<p class="muted events-empty">Nothing on the calendar this month.</p>
				{:else}
					<!-- The month's events: wide rows, three at a time (owner
					     ruling 2026-08-26) - the words on the left, the
					     gallery at the row's side; the pager pages the rest. -->
					<div class="events-row">
						{#each data.events as event (event.id)}
							<article class="event card" id={'ev-' + event.id}>
								<div class="event-body">
									<p class="muted event-date">
										{event.dateLabel}{#if event.timeLabel}
											&middot; <span data-epoch={event.epoch} data-date={event.date}
												>{event.timeLabel}</span
											>{/if}
									</p>
									<h3 class="event-title">{event.title}</h3>
									{#if event.place}
										<p class="event-place">{event.place}</p>
									{/if}
									{#if event.notes}
										<p class="event-notes">{event.notes}</p>
									{/if}
								</div>
								{#if event.imageIds.length}
									<EventGallery
										imageIds={event.imageIds}
										title={event.title}
										returnTo={'ev-' + event.id}
										maxThumbs={3}
									/>
								{/if}
							</article>
						{/each}
					</div>
					{#if data.eventsPager.pages > 1}
						<nav class="events-pager">
							{#if data.eventsPager.page > 1}
								<a
									class="cal-arrow"
									href={`${resolve('/home')}${homeQuery({ ev: data.eventsPager.page - 1 })}`}
									aria-label="Earlier events">&larr;</a
								>
							{:else}
								<span class="cal-arrow off">&larr;</span>
							{/if}
							<p>{data.eventsPager.from}-{data.eventsPager.to} of {data.eventsPager.total}</p>
							{#if data.eventsPager.page < data.eventsPager.pages}
								<a
									class="cal-arrow"
									href={`${resolve('/home')}${homeQuery({ ev: data.eventsPager.page + 1 })}`}
									aria-label="Later events">&rarr;</a
								>
							{:else}
								<span class="cal-arrow off">&rarr;</span>
							{/if}
						</nav>
					{/if}
				{/if}
			</div>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</section>

		<section class="fold-entry">
			<!-- The heading stands outside the card like its neighbours,
			     and carries no date - the calendar already says what day
			     it is (owner corrections on the drive, 2026-08-26). -->
			<h2>Add your current information</h2>
			<div class="card home-entry">
				<!-- The toggle is a link carrying ?u= for one page view; a
				     reload falls back to the Settings default (owner ruling
				     2026-08-26). -->
				<nav class="units">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() is in the template; the rule cannot see through the query string -->
					<a
						href={`${resolve('/home')}${homeQuery({ u: 'imperial' })}`}
						class:on={data.units === 'imperial'}
						aria-current={data.units === 'imperial'}>Imperial (US)</a
					>
					<a
						href={`${resolve('/home')}${homeQuery({ u: 'metric' })}`}
						class:on={data.units === 'metric'}
						aria-current={data.units === 'metric'}>Metric</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
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
