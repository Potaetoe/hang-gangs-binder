<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section>
	<h2>Members</h2>
	{#if !data.roster.length}
		<p class="muted">Nobody yet.</p>
	{:else}
		<div class="table-scroll card">
			<table class="admin-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Standing</th>
						<th>Doors</th>
						<th>Entries</th>
						<th>Last entry</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.roster as member (member.id)}
						<tr>
							<td>{member.name}</td>
							<td
								>{member.status === 'pending' ? 'pending' : member.isAdmin ? 'admin' : 'member'}</td
							>
							<td>{member.doors}</td>
							<td>{member.entryCount}</td>
							<td>{member.lastEntry ?? ''}</td>
							<td><a href={resolve('/admin/members/[id]', { id: member.id })}>Open</a></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
