<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>Approvals</h2>
	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}
	{#if !data.pending.length}
		<p class="muted">Nobody is waiting.</p>
	{:else}
		<ul class="history">
			{#each data.pending as member (member.id)}
				<li class="card">
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
	{/if}
</section>
