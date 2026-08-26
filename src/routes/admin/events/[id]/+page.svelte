<script lang="ts">
	import { resolve } from '$app/paths';
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
			{data.skipped === 1 ? 'One image' : `${data.skipped} images`} did not make it — each must be an
			image, 2 MB at most, 8 to an event.
		</p>
	{/if}
	{#if form?.done}
		<p class="muted done">{form.done}</p>
	{/if}

	<form method="POST" action="?/save" class="card settings-form">
		<label for="event-title">What is happening</label>
		<input
			id="event-title"
			name="title"
			autocomplete="off"
			maxlength="80"
			value={data.event.title}
		/>
		<label for="event-date">The day</label>
		<input id="event-date" name="date" type="date" value={data.event.date} />
		<label for="event-place">Where (optional)</label>
		<input
			id="event-place"
			name="place"
			autocomplete="off"
			maxlength="120"
			value={data.event.place}
		/>
		<label for="event-notes">Notes (optional)</label>
		<textarea id="event-notes" name="notes" rows="3" maxlength="2000">{data.event.notes}</textarea>
		<button>Save the event</button>
	</form>

	<div class="card">
		<h3>Images</h3>
		{#if data.images.length}
			<div class="gallery">
				{#each data.images as image (image.id)}
					<div class="gallery-slot">
						<a href={resolve('/events/image/[id]', { id: image.id })}>
							<img
								src={resolve('/events/image/[id]', { id: image.id })}
								alt={'For ' + data.event.title}
								loading="lazy"
							/>
						</a>
						<form method="POST" action="?/delimage">
							<input type="hidden" name="image" value={image.id} />
							<button class="quiet gallery-remove">Remove</button>
						</form>
					</div>
				{/each}
			</div>
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
