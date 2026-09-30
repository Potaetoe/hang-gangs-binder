<script lang="ts">
	import EventGallery from '$lib/components/EventGallery.svelte';
	import type { EventView } from '$lib/views';

	/** `evPage` and `page` ride along on the RSVP post so the member lands
	 * back on the same card. */
	let { event, evPage, page }: { event: EventView; evPage: number; page: number } = $props();

	const countText = $derived(
		event.rsvpCount
			? `${event.rsvpCount} interested`
			: event.rsvpOpen
				? 'No one yet'
				: 'No one was interested'
	);
</script>

<article class="event card" id={'ev-' + event.id}>
	<div class="event-body">
		<p class="muted event-date">
			{event.dateLabel}{#if event.timeLabel}&nbsp;&middot;
				<span data-epoch={event.epoch} data-date={event.date}>{event.timeLabel}</span>{/if}
		</p>
		<h3 class="event-title">{event.title}</h3>
		{#if event.place}
			<p class="event-place">{event.place}</p>
		{/if}
		{#if event.notes}
			<p class="event-notes">{event.notes}</p>
		{/if}
		<div class="event-rsvp">
			<p class="rsvp-count">
				{countText}{#if event.rsvpMine}&nbsp;&middot; including you{/if}
			</p>
			{#if event.rsvpOpen}
				<form method="POST" action="?/rsvp">
					<input type="hidden" name="event" value={event.id} />
					<input type="hidden" name="on" value={event.rsvpMine ? '0' : '1'} />
					<input type="hidden" name="ev" value={evPage} />
					<input type="hidden" name="page" value={page} />
					<button class:rsvp-on={event.rsvpMine} aria-pressed={event.rsvpMine}
						>{event.rsvpMine ? 'Interested ✓' : "I'm interested"}</button
					>
				</form>
				{#if event.rsvpUntilLabel}
					<p class="muted rsvp-until">RSVP open through {event.rsvpUntilLabel}</p>
				{/if}
			{:else}
				<p class="muted rsvp-until">RSVP closed</p>
			{/if}
		</div>
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
