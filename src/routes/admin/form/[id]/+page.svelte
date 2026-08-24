<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>
		{data.field.name}
		{#if !data.field.active}<span class="badge pending">off the form</span>{/if}
		{#if data.field.essential}<span class="badge">essential</span>{/if}
		{#if data.field.multiple}<span class="badge">pick several</span>{/if}
	</h2>
	{#if data.field.computed}
		<p class="muted">Worked out from height and weight; nobody types it.</p>
	{/if}

	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}

	<div class="card">
		<h3>Name</h3>
		<form method="POST" action="?/rename" class="name-row">
			<label class="sr-only" for="field-name">Field name</label>
			<input
				id="field-name"
				name="name"
				autocomplete="off"
				maxlength="40"
				value={data.field.name}
			/>
			<button>Rename</button>
		</form>
	</div>

	{#if data.field.isChoice}
		<div class="card">
			<h3>Options</h3>
			{#if data.field.multiple}
				<p class="muted">Members tick as many of these as apply.</p>
			{/if}
			{#if !data.field.options.length}
				<p class="muted">
					No options yet — the field stays off the form until it has at least one.
				</p>
			{/if}
			<ul class="history">
				{#each data.field.options as option (option)}
					<li>
						<p class="entry-summary">{option}</p>
						<div class="approve-actions">
							<details class="flap option-flap">
								<summary>Rename</summary>
								<form method="POST" action="?/renameoption" class="name-row">
									<input type="hidden" name="from" value={option} />
									<label class="sr-only" for={'rename-' + option}>New name for {option}</label>
									<input
										id={'rename-' + option}
										name="to"
										autocomplete="off"
										maxlength="60"
										value={option}
									/>
									<button>Save</button>
								</form>
							</details>
							<form method="POST" action="?/removeoption">
								<input type="hidden" name="option" value={option} />
								<button class="quiet">Remove</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
			<p class="muted">
				Renaming an option renames it in everyone's history too. Removing one only stops new picks —
				members who chose it keep it.
			</p>
			<form method="POST" action="?/addoption" class="name-row">
				<label class="sr-only" for="new-option">New option</label>
				<input id="new-option" name="option" autocomplete="off" maxlength="60" />
				<button>Add option</button>
			</form>
		</div>
	{/if}

	<div class="admin-actions card">
		{#if data.field.isChoice && !data.field.multiple}
			<details class="flap button-flap">
				<summary>Let members pick several</summary>
				<form method="POST" action="?/multiple">
					<p class="muted">
						Checkboxes instead of one pick. Answers already given stay as they are. This cannot be
						undone — several picks can never be squeezed back into one.
					</p>
					<button>Yes, allow several</button>
				</form>
			</details>
		{/if}
		{#if data.field.active}
			{#if !data.field.essential}
				<details class="flap button-flap">
					<summary>Take it off the form</summary>
					<form method="POST" action="?/retire">
						<p class="muted">
							The field leaves the form and the charts. Its history stays, and it can come back.
						</p>
						<button>Yes, take it off</button>
					</form>
				</details>
			{:else}
				<p class="muted">Height, weight and BMI are essential — they stay on the form.</p>
			{/if}
		{:else}
			<form method="POST" action="?/revive">
				<button>Put it on the form</button>
			</form>
			{#if !data.field.used}
				<details class="flap button-flap">
					<summary>Delete it</summary>
					<form method="POST" action="?/delete">
						<p class="muted">It never collected a value, so it can go completely.</p>
						<button>Yes, delete it</button>
					</form>
				</details>
			{/if}
		{/if}
	</div>

	<p><a href={resolve('/admin/form')}>&larr; The whole form</a></p>
</section>
