<script lang="ts">
	import { resolve } from '$app/paths';
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
						<th>Event</th>
						<th>Place</th>
						<th>Images</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.events as event (event.id)}
						<tr>
							<td>{event.dateLabel}</td>
							<td>{event.title}</td>
							<td>{event.place || '—'}</td>
							<td>{event.imageCount || '—'}</td>
							<td><a href={resolve('/admin/events/[id]', { id: event.id })}>Open</a></td>
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
			<label for="event-title">What is happening</label>
			<input id="event-title" name="title" autocomplete="off" maxlength="80" />
			<label for="event-date">The day</label>
			<input id="event-date" name="date" type="date" />
			<label for="event-place">Where (optional)</label>
			<input id="event-place" name="place" autocomplete="off" maxlength="120" />
			<label for="event-notes">Notes (optional)</label>
			<textarea id="event-notes" name="notes" rows="3" maxlength="2000"></textarea>
			<label for="event-images">Images (optional)</label>
			<input id="event-images" name="images" type="file" accept="image/*" multiple />
			<p class="muted">Up to 8 images, each 2 MB at most — flyers, not photo dumps.</p>
			<button>Add the event</button>
		</form>
	</div>
</section>
