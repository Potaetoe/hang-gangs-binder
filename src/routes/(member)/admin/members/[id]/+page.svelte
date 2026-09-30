<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<script src="/reveal.js" defer></script>
</svelte:head>

<section>
	<h2>
		{data.member.name}
		{#if data.member.isAdmin}<span class="badge">admin</span>{/if}
		{#if data.member.status === 'pending'}<span class="badge pending">pending</span>{/if}
	</h2>
	<p class="muted">
		{data.member.username ? `username: ${data.member.username} · ` : ''}{data.member.handle
			? `telegram: @${data.member.handle} · `
			: ''}sign-in: {data.member.doors || 'none'}
	</p>

	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}
	{#if form?.done}
		<p class="muted done">
			{form.done}
			<!-- The door wants the username, not the display name above. -->
			{#if data.member.username}They sign in as <strong>{data.member.username}</strong>.{/if}
		</p>
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
		{#if data.hasPasswordDoor}
			<details class="flap button-flap">
				<summary>Reset password</summary>
				<form method="POST" action="?/passphrase">
					<label for="passphrase">Temporary passphrase ({data.passwordMin}+ characters)</label>
					<div class="reveal-row">
						<input id="passphrase" name="passphrase" type="password" autocomplete="new-password" />
						<!-- reveal.js unhides this; without it the box stays dots. -->
						<button type="button" class="quiet" data-reveal="passphrase" hidden>Show</button>
					</div>
					<p class="muted">
						Hand it to them yourself — Telegram, in person, anywhere but here. Their next sign-in
						demands a password of their own, and every open session is signed out now.
					</p>
					<button>Set passphrase</button>
				</form>
			</details>
		{/if}
		{#if data.hasSocials}
			<details class="flap button-flap">
				<summary>Clear their socials</summary>
				<form method="POST" action="?/clearsocials">
					<p class="muted">
						Their links leave the Socials page. They can add fresh ones any time; the change log
						keeps the line.
					</p>
					<button>Yes, clear them</button>
				</form>
			</details>
		{/if}
		<details class="flap button-flap">
			<summary>Remove this member for good</summary>
			<form method="POST" action="?/purge">
				<p class="muted">
					Everything goes: the account, every sign-in, every entry, the correction trail. The change
					log keeps one unlinkable line. There is no undo.
				</p>
				<button>Yes, remove everything</button>
			</form>
		</details>
	</div>

	<section>
		<h3>Entries ({data.entries.rows.length})</h3>
		{#if !data.entries.rows.length}
			<p class="muted">None.</p>
		{:else}
			<div class="table-scroll card">
				<table class="admin-table">
					<thead>
						<tr>
							<th>Date</th>
							{#each data.entries.columns as name (name)}
								<th>{name}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.entries.rows as entry (entry.id)}
							<tr>
								<td>{entry.dateLabel}</td>
								{#each entry.cells as cell, j (j)}
									<td>{cell}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
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
