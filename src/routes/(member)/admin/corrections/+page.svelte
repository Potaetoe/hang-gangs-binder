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
		<div class="table-scroll card">
			<table class="admin-table">
				<thead>
					<tr>
						<th>Date</th>
						<th>Member</th>
						<th>Action</th>
						<th>Entry from</th>
						<th>Was</th>
					</tr>
				</thead>
				<tbody>
					{#each data.lines as line, i (i)}
						<tr>
							<td>{line.date}</td>
							<td>{line.member}</td>
							<td>{line.action === 'edit' ? 'edited' : 'deleted'}</td>
							<td>{line.entryDate}</td>
							<td>{line.before}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
