<script lang="ts">
	import { resolve } from '$app/paths';
	import EventFields from './EventFields.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>Events</h2>
	<p class="muted">
		What the group's calendar says. An event you add is on every member's home page as soon as you
		save it.
	</p>
	{#if form?.problems}
		<ul class="error problems">
			{#each form.problems as problem (problem)}
				<li>{problem}</li>
			{/each}
		</ul>
	{/if}

	{#if data.events.length}
		<div class="table-scroll card">
			<table class="admin-table">
				<thead>
					<tr>
						<th>Date</th>
						<th>Time</th>
						<th>Event</th>
						<th>Place</th>
						<th>Images</th>
						<th>Interested</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.events as event (event.id)}
						<tr>
							<td>{event.dateLabel}</td>
							<td>{event.timeLabel}</td>
							<td>{event.title}</td>
							<td>{event.place || '—'}</td>
							<td>{event.imageCount || '—'}</td>
							<td>{event.rsvpCount || '—'}</td>
							<td><a href={resolve('/(member)/admin/events/[id]', { id: event.id })}>Open</a></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="muted">No events yet — the form below starts the calendar.</p>
	{/if}

	<div class="card">
		<h3>Add an event</h3>
		<form method="POST" action="?/add" enctype="multipart/form-data">
			<EventFields tz={data.siteTz} timezoneChoices={data.timezoneChoices} />
			<label for="event-images">Images (optional)</label>
			<input id="event-images" name="images" type="file" accept="image/*" multiple />
			<p class="muted">Up to 8 images, each 2 MB at most — flyers, not photo dumps.</p>
			<button>Add the event</button>
		</form>
	</div>
</section>
