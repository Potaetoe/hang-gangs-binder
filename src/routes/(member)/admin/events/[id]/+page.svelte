<script lang="ts">
	import { resolve } from '$app/paths';
	import EventGallery from '$lib/components/EventGallery.svelte';
	import EventFields from '../EventFields.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>{data.event.title}</h2>
	{#if form?.problems}
		<ul class="error problems">
			{#each form.problems as problem (problem)}
				<li>{problem}</li>
			{/each}
		</ul>
	{/if}
	{#if data.skipped}
		<p class="error">
			{data.skipped === 1 ? 'One image' : `${data.skipped} images`} did not make it — {data.skippedRule}.
		</p>
	{/if}
	{#if form?.done}
		<p class="muted done">{form.done}</p>
	{/if}

	<form method="POST" action="?/save" class="card settings-form">
		<EventFields
			event={data.event}
			tz={data.event.tz || data.siteTz}
			timezoneChoices={data.timezoneChoices}
		/>
		<button>Save the event</button>
	</form>

	<div class="card" id="interested">
		<h3>Interested ({data.interested.length})</h3>
		<p class="muted">
			{data.rsvpOpen ? 'RSVP open through' : 'RSVP closed after'}
			{data.rsvpLastDayLabel}. Members see only the count; these names are for admins.
		</p>
		{#if data.interested.length}
			<ul class="rsvp-names">
				{#each data.interested as person (person.id)}
					<li>
						<a href={resolve('/(member)/admin/members/[id]', { id: person.id })}>{person.name}</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No one yet.</p>
		{/if}
	</div>

	<div class="card" id="images">
		<h3>Images</h3>
		{#if data.imageIds.length}
			<EventGallery imageIds={data.imageIds} title={data.event.title} returnTo="images" removable />
		{:else}
			<p class="muted">No images yet.</p>
		{/if}
		<form method="POST" action="?/addimages" enctype="multipart/form-data">
			<label for="event-images">Add images</label>
			<input id="event-images" name="images" type="file" accept="image/*" multiple />
			<p class="muted">Up to 8 images on an event, each 2 MB at most.</p>
			<button>Add the images</button>
		</form>
	</div>

	<details class="flap delete-flap">
		<summary>Delete this event</summary>
		<form method="POST" action="?/delete">
			<p class="muted">It leaves every member's calendar, images and all. There is no undo.</p>
			<button>Yes, delete it</button>
		</form>
	</details>

	<p><a href={resolve('/admin/events')}>&larr; Back to events</a></p>
</section>
