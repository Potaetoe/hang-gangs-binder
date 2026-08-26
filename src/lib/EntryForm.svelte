<script lang="ts">
	import type { FormFieldView } from '$lib/views';

	let {
		fields,
		units,
		raw = {},
		problems = [],
		action,
		submitLabel
	}: {
		fields: FormFieldView[];
		/** The units the form renders in, posted back with it so the
		 * server parses what the member actually saw - the view can be
		 * one page load old by the time the submit lands. */
		units: string;
		/** What a failed submit actually typed, echoed back over the
		 * pre-fill so nothing anyone wrote is thrown away. Checkboxes
		 * submit one value per tick, so every key holds a list. */
		raw?: Record<string, string[]>;
		problems?: string[];
		action: string;
		submitLabel: string;
	} = $props();

	const r = (key: string, fallback: string) => raw[key]?.[0] ?? fallback;

	// A failed submit echoes at least one key (text boxes and selects
	// always send). When it does, unchecked boxes must STAY unchecked -
	// falling back to the pre-fill would undo what the member just did.
	const echoed = $derived(Object.keys(raw).length > 0);
	const ticked = (f: FormFieldView, option: string) =>
		echoed ? (raw['f_' + f.id] ?? []).includes(option) : f.picks.includes(option);
</script>

<form method="POST" {action}>
	<input type="hidden" name="units" value={units} />
	{#if problems.length}
		<ul class="error problems">
			{#each problems as problem (problem)}
				<li>{problem}</li>
			{/each}
		</ul>
	{/if}
	{#each fields as f (f.id)}
		{#if f.kind === 'choice'}
			<label for={'f-' + f.id}>{f.name}</label>
			<select id={'f-' + f.id} name={'f_' + f.id}>
				<option value="">—</option>
				{#each f.options as option (option)}
					<option value={option} selected={r('f_' + f.id, f.choice) === option}>{option}</option>
				{/each}
			</select>
		{:else if f.kind === 'multi'}
			<fieldset class="picks">
				<legend>{f.name}</legend>
				{#each f.options as option (option)}
					<label class="pick">
						<input type="checkbox" name={'f_' + f.id} value={option} checked={ticked(f, option)} />
						<span>{option}</span>
					</label>
				{/each}
			</fieldset>
		{:else if f.kind === 'length'}
			<label for={'f-' + f.id + '-ft'}>{f.name}</label>
			<div class="row">
				<input
					id={'f-' + f.id + '-ft'}
					name={'f_' + f.id + '_ft'}
					inputmode="numeric"
					autocomplete="off"
					placeholder="5"
					aria-label={f.name + ', feet'}
					value={r('f_' + f.id + '_ft', f.ft)}
				/>
				<span class="suffix">ft</span>
				<input
					id={'f-' + f.id + '-in'}
					name={'f_' + f.id + '_in'}
					inputmode="decimal"
					autocomplete="off"
					placeholder="10"
					aria-label={f.name + ', inches'}
					value={r('f_' + f.id + '_in', f.inches)}
				/>
				<span class="suffix">in</span>
			</div>
		{:else if f.kind === 'computed'}
			<p class="muted computed">{f.name} is worked out from height and weight.</p>
		{:else}
			<label for={'f-' + f.id}>{f.name}</label>
			<div class="row">
				<input
					id={'f-' + f.id}
					name={'f_' + f.id}
					inputmode="decimal"
					autocomplete="off"
					value={r('f_' + f.id, f.single)}
				/>
				{#if f.unit}<span class="suffix">{f.unit}</span>{/if}
			</div>
		{/if}
	{/each}
	<button>{submitLabel}</button>
</form>
