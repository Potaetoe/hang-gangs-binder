<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// A preview or failed save echoes the builder's picks back, so the
	// re-rendered form still holds what the admin had chosen.
	const calcRaw = $derived(
		form && 'calcRaw' in form && form.calcRaw ? (form.calcRaw as Record<string, string>) : null
	);
	const rawOr = (key: string, fallback: string) => (calcRaw ? (calcRaw[key] ?? '') : fallback);
	const stepState = (i: number) => ({
		op: rawOr(`step${i + 1}_op`, data.calc?.steps[i]?.op ?? ''),
		pick: rawOr(`step${i + 1}_pick`, data.calc?.steps[i]?.pick ?? ''),
		constant: rawOr(`step${i + 1}_const`, data.calc?.steps[i]?.constant ?? '')
	});
</script>

<section>
	<h2>
		{data.field.name}
		{#if !data.field.active}<span class="badge pending">off the form</span>{/if}
		{#if data.field.essential}<span class="badge">essential</span>{/if}
		{#if data.field.multiple}<span class="badge">pick several</span>{/if}
	</h2>
	{#if data.field.computed}
		<p class="muted">Worked out from other fields; nobody types it.</p>
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

	{#if data.calc}
		<div class="card">
			<h3>The recipe</h3>
			{#if data.calc.locked}
				<p class="muted">
					BMI's recipe is fixed: {data.calc.recipe}. It can be renamed, never rewritten.
				</p>
			{:else}
				{#if data.calc.recipe}
					<p class="muted">
						Now: {data.calc.recipe} — {data.calc.units === 'metric'
							? 'one number for everyone'
							: 'follows the units toggle'}, {data.calc.decimals} decimal{data.calc.decimals === 1
							? ''
							: 's'}.
					</p>
				{:else}
					<p class="muted">No recipe yet — the field stays off the form until it has one.</p>
				{/if}
				{#if form?.problems}
					<ul class="error problems">
						{#each form.problems as problem (problem)}
							<li>{problem}</li>
						{/each}
					</ul>
				{/if}
				{#if form?.preview}
					<p class="done">
						With every field at 100 (first entry 90, previous 95): <strong>{form.preview}</strong>
					</p>
				{/if}
				<form method="POST" action="?/formula" class="calc-form">
					<div class="calc-row">
						<span class="calc-word">Start with</span>
						<label class="sr-only" for="start-pick">What the recipe starts from</label>
						<select id="start-pick" name="start_pick">
							<option value="">—</option>
							{#each data.calc.choices as choice (choice.value)}
								<option
									value={choice.value}
									selected={rawOr('start_pick', data.calc.start.pick) === choice.value}
									>{choice.label}</option
								>
							{/each}
							<option value="const" selected={rawOr('start_pick', data.calc.start.pick) === 'const'}
								>a number you type</option
							>
						</select>
						<label class="sr-only" for="start-const">The typed number</label>
						<input
							id="start-const"
							name="start_const"
							autocomplete="off"
							placeholder="number"
							value={rawOr('start_const', data.calc.start.constant)}
						/>
					</div>
					{#each [...Array(data.calc.steps.length).keys()] as i (i)}
						{@const step = stepState(i)}
						<div class="calc-row">
							<label class="sr-only" for={'step-op-' + i}>Step {i + 1} operation</label>
							<select id={'step-op-' + i} name={`step${i + 1}_op`} class="calc-op">
								<option value="">—</option>
								{#each data.calc.ops as op (op.value)}
									<option value={op.value} selected={step.op === op.value}>{op.label}</option>
								{/each}
							</select>
							<label class="sr-only" for={'step-pick-' + i}>Step {i + 1} reads</label>
							<select id={'step-pick-' + i} name={`step${i + 1}_pick`}>
								<option value="">—</option>
								{#each data.calc.choices as choice (choice.value)}
									<option value={choice.value} selected={step.pick === choice.value}
										>{choice.label}</option
									>
								{/each}
								<option value="const" selected={step.pick === 'const'}>a number you type</option>
							</select>
							<label class="sr-only" for={'step-const-' + i}>Step {i + 1} typed number</label>
							<input
								id={'step-const-' + i}
								name={`step${i + 1}_const`}
								autocomplete="off"
								placeholder="number"
								value={step.constant}
							/>
						</div>
					{/each}
					<p class="muted">
						Steps work left to right. A step with no operation is skipped. Pick "a number you type"
						and put the number in the box beside it.
					</p>
					<label for="calc-units">Whose numbers it reads</label>
					<select id="calc-units" name="units">
						<option value="both" selected={rawOr('units', data.calc.units) === 'both'}
							>Follows the units toggle — right for gains and differences</option
						>
						<option value="metric" selected={rawOr('units', data.calc.units) === 'metric'}
							>One number for everyone, from metric — right for BMI-style ratios</option
						>
					</select>
					<label for="calc-decimals">Decimals</label>
					<select id="calc-decimals" name="decimals">
						{#each [0, 1, 2] as d (d)}
							<option
								value={d}
								selected={rawOr('decimals', String(data.calc.decimals)) === String(d)}>{d}</option
							>
						{/each}
					</select>
					<div class="admin-actions">
						<button class="quiet" formaction="?/preview">Preview</button>
						<button>Save the recipe</button>
					</div>
				</form>
			{/if}
		</div>
	{/if}

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
						{#if data.readBy.length}
							<p class="error">
								Careful: {data.readBy.join(', ')}
								{data.readBy.length === 1 ? 'reads' : 'read'} this field — new entries there go blank
								until it returns.
							</p>
						{/if}
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
						{#if data.readBy.length}
							<p class="error">
								Careful: {data.readBy.join(', ')}
								{data.readBy.length === 1 ? 'reads' : 'read'} this field — those recipes go blank for
								good.
							</p>
						{/if}
						<button>Yes, delete it</button>
					</form>
				</details>
			{/if}
		{/if}
	</div>

	<p><a href={resolve('/admin/form')}>&larr; The whole form</a></p>
</section>
