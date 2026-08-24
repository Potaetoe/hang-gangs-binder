<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>Members</h2>
	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}

	{#if data.pending.length}
		<div class="card pending-card">
			<h3>Waiting to be approved</h3>
			<ul class="history">
				{#each data.pending as member (member.id)}
					<li>
						<div>
							<p class="entry-summary">{member.name}</p>
							<p class="muted entry-date">
								{member.username ? `username: ${member.username}` : 'no username'}
							</p>
						</div>
						<div class="approve-actions">
							<form method="POST" action="?/approve">
								<input type="hidden" name="id" value={member.id} />
								<button>Approve</button>
							</form>
							<form method="POST" action="?/deny">
								<input type="hidden" name="id" value={member.id} />
								<button class="quiet">Deny</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
			<p class="muted">Denying deletes the registration; the username frees up again.</p>
		</div>
	{/if}

	{#if !data.roster.length}
		<p class="muted">Nobody yet.</p>
	{:else}
		<div class="table-scroll card">
			<table class="admin-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Standing</th>
						<th>Sign-in</th>
						<th>Entries</th>
						<th>Last entry</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.roster as member (member.id)}
						<tr>
							<td>{member.name}</td>
							<td>{member.isAdmin ? 'admin' : 'member'}</td>
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
