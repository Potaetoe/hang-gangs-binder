<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section>
	<h2>Change log</h2>
	{#if !data.lines.length}
		<p class="muted">Nothing yet — admin actions land here.</p>
	{:else}
		<div class="table-scroll card">
			<table class="admin-table">
				<thead>
					<tr>
						<th>Date</th>
						<th>Admin</th>
						<th>Action</th>
						<th>Member</th>
						<th>Detail</th>
					</tr>
				</thead>
				<tbody>
					{#each data.lines as line, i (i)}
						<tr>
							<td>{line.date}</td>
							<td>{line.actor}</td>
							<td>{line.action}</td>
							<td>{line.subject ?? ''}</td>
							<td>{line.detail ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
