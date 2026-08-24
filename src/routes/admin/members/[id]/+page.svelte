<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>
		{data.member.name}
		{#if data.member.isAdmin}<span class="badge">admin</span>{/if}
		{#if data.member.status === 'pending'}<span class="badge pending">pending</span>{/if}
	</h2>
	<p class="muted">
		{data.member.username ? `username: ${data.member.username} · ` : ''}{data.member.handle
			? `telegram: @${data.member.handle} · `
			: ''}doors: {data.member.doors || 'none'}
	</p>

	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}
	{#if form?.done}
		<p class="muted done">{form.done}</p>
	{/if}

	<div class="admin-actions card">
		{#if data.member.status === 'pending'}
			<form method="POST" action="?/approve">
				<button>Approve</button>
			</form>
			<form method="POST" action="?/deny">
				<button class="quiet">Deny &amp; delete</button>
			</form>
		{:else}
			<form method="POST" action="?/role">
				<input type="hidden" name="make" value={data.member.isAdmin ? 'member' : 'admin'} />
				<button class="quiet">{data.member.isAdmin ? 'Remove admin' : 'Make admin'}</button>
			</form>
		{/if}
	</div>

	{#if data.hasPasswordDoor}
		<details class="flap">
			<summary>Set a temporary passphrase</summary>
			<form method="POST" action="?/passphrase">
				<label for="passphrase">Temporary passphrase (8+ characters)</label>
				<input id="passphrase" name="passphrase" autocomplete="off" />
				<p class="muted">
					Hand it to them yourself — Telegram, in person, anywhere but here. Their next sign-in
					demands a password of their own, and every open session is signed out now.
				</p>
				<button>Set passphrase</button>
			</form>
		</details>
	{/if}

	<details class="flap">
		<summary>Remove this member for good</summary>
		<form method="POST" action="?/purge">
			<p class="muted">
				Everything goes: the account, both doors, every entry, the correction trail. The change log
				keeps one unlinkable line. There is no undo.
			</p>
			<button>Yes, remove everything</button>
		</form>
	</details>

	<section>
		<h3>Entries ({data.entries.length})</h3>
		{#if !data.entries.length}
			<p class="muted">None.</p>
		{:else}
			<ul class="history">
				{#each data.entries as entry, i (i)}
					<li class="card">
						<div>
							<p class="muted entry-date">{entry.dateLabel}</p>
							<p class="entry-summary">{entry.summary || '—'}</p>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if data.corrections.length}
		<section>
			<h3>Corrections</h3>
			<ul class="history">
				{#each data.corrections as c, i (i)}
					<li class="card">
						<p class="entry-summary">
							{c.date} · {c.action === 'edit' ? 'edited' : 'deleted'} the entry from {c.entryDate}
						</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p><a href={resolve('/admin/members')}>&larr; All members</a></p>
</section>
