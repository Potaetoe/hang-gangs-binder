<script lang="ts">
	import { resolve } from '$app/paths';

	/**
	 * An event's gallery: thumbnails, and a preview overlay per image
	 * (owner ruling 2026-08-26). The overlay is CSS `:target` - open,
	 * previous, next and close are plain links, because member pages
	 * ship no JavaScript. `returnTo` is the element id a close jumps
	 * back to. `maxThumbs` caps the thumbnails; the rest fold into a
	 * "+N more" tile that opens the overlay where the arrows reach
	 * every image.
	 */
	let {
		imageIds,
		title,
		returnTo,
		removable = false,
		maxThumbs = Infinity
	}: {
		imageIds: string[];
		title: string;
		returnTo: string;
		removable?: boolean;
		maxThumbs?: number;
	} = $props();

	const shown = $derived(imageIds.slice(0, maxThumbs));
	const hidden = $derived(imageIds.length - shown.length);
</script>

<div class="gallery">
	{#each shown as id (id)}
		<div class="gallery-slot">
			<a href={'#lb-' + id}>
				<img src={resolve('/events/image/[id]', { id })} alt={'For ' + title} loading="lazy" />
			</a>
			{#if removable}
				<form method="POST" action="?/delimage">
					<input type="hidden" name="image" value={id} />
					<button class="quiet gallery-remove">Remove</button>
				</form>
			{/if}
		</div>
	{/each}
	{#if hidden > 0}
		<a class="gallery-more" href={'#lb-' + imageIds[shown.length]}>+{hidden} more</a>
	{/if}
</div>
{#each imageIds as id, i (id)}
	<div class="lightbox" id={'lb-' + id}>
		<a class="lightbox-shut" href={'#' + returnTo} aria-label="Close the image"></a>
		<a class="lightbox-x" href={'#' + returnTo} aria-label="Close the image">&times;</a>
		<div class="lightbox-body">
			<img
				src={resolve('/events/image/[id]', { id })}
				alt={`${title}, image ${i + 1} of ${imageIds.length}`}
				loading="lazy"
			/>
			<div class="lightbox-bar">
				{#if i > 0}
					<a class="lightbox-step" href={'#lb-' + imageIds[i - 1]} aria-label="Previous image"
						>&larr;</a
					>
				{:else}
					<span class="lightbox-step off">&larr;</span>
				{/if}
				<p>{i + 1} of {imageIds.length}</p>
				{#if i < imageIds.length - 1}
					<a class="lightbox-step" href={'#lb-' + imageIds[i + 1]} aria-label="Next image">&rarr;</a
					>
				{:else}
					<span class="lightbox-step off">&rarr;</span>
				{/if}
			</div>
		</div>
	</div>
{/each}
