<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section>
	<h2>Change log</h2>
	{#if !data.lines.length}
		<p class="muted">Nothing yet — admin actions land here.</p>
	{:else}
		<ul class="history">
			{#each data.lines as line, i (i)}
				<li class="card">
					<div>
						<p class="muted entry-date">{line.date}</p>
						<p class="entry-summary">
							{line.actor}
							{line.action}{line.subject ? ` — ${line.subject}` : ''}{line.detail
								? ` (${line.detail})`
								: ''}
						</p>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
