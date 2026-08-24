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
		<ul class="history">
			{#each data.roster as member (member.id)}
				<li class="card">
					<div>
						<p class="entry-summary">
							{member.name}
							{#if member.isAdmin}<span class="badge">admin</span>{/if}
							{#if member.status === 'pending'}<span class="badge pending">pending</span>{/if}
						</p>
						<p class="muted entry-date">
							{member.doors} &middot; {member.entryCount}
							{member.entryCount === 1 ? 'entry' : 'entries'}{member.lastEntry
								? ` · last ${member.lastEntry}`
								: ''}
						</p>
					</div>
					<a href={resolve('/admin/members/[id]', { id: member.id })}>Open</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
