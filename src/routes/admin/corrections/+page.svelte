<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section>
	<h2>Corrections</h2>
	<p class="muted">
		Every member edit or delete keeps its before-image here, separate from the admin change log.
	</p>
	{#if !data.lines.length}
		<p class="muted">No corrections yet.</p>
	{:else}
		<ul class="history">
			{#each data.lines as line, i (i)}
				<li class="card">
					<div>
						<p class="muted entry-date">{line.date}</p>
						<p class="entry-summary">
							{line.member}
							{line.action === 'edit' ? 'edited' : 'deleted'} the entry from {line.entryDate}
						</p>
						{#if line.before}
							<p class="muted entry-date">was: {line.before}</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
