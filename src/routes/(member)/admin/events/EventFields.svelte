<script lang="ts">
	/** The inputs an event is made of, shared by the add and edit forms. */
	let {
		event = { title: '', date: '', time: '', place: '', notes: '', rsvpUntil: '' },
		tz,
		timezoneChoices
	}: {
		event?: {
			title: string;
			date: string;
			time: string;
			place: string;
			notes: string;
			rsvpUntil: string;
		};
		tz: string;
		timezoneChoices: { id: string; name: string }[];
	} = $props();
</script>

<label for="event-title">What is happening</label>
<input id="event-title" name="title" autocomplete="off" maxlength="80" value={event.title} />
<label for="event-date">The day</label>
<input id="event-date" name="date" type="date" value={event.date} />
<label for="event-time">Time (optional — blank means all day)</label>
<div class="row">
	<input id="event-time" name="time" type="time" value={event.time} />
	<select name="tz" aria-label="The timezone the time is in">
		{#each timezoneChoices as zone (zone.id)}
			<option value={zone.id} selected={zone.id === tz}>{zone.name}</option>
		{/each}
	</select>
</div>
<p class="muted">The time is in the zone you pick here; members see it in their own clock.</p>
<label for="event-place">Where (optional)</label>
<input id="event-place" name="place" autocomplete="off" maxlength="120" value={event.place} />
<label for="event-notes">Notes (optional)</label>
<textarea id="event-notes" name="notes" rows="3" maxlength="2000">{event.notes}</textarea>
<label for="event-rsvp-until">RSVP open through (optional — blank means the event's day)</label>
<input id="event-rsvp-until" name="rsvp_until" type="date" value={event.rsvpUntil} />
<p class="muted">
	Members can tap "I'm interested" through this day. Pick an earlier day to close it sooner, or a
	past day to close it now.
</p>
