<script lang="ts">
	import type { FormFieldView } from '$lib/views';

	let {
		fields,
		raw = {},
		problems = [],
		action,
		submitLabel
	}: {
		fields: FormFieldView[];
		/** What a failed submit actually typed, echoed back over the
		 * pre-fill so nothing anyone wrote is thrown away. */
		raw?: Record<string, string>;
		problems?: string[];
		action: string;
		submitLabel: string;
	} = $props();

	const r = (key: string, fallback: string) => raw[key] ?? fallback;
</script>

<form method="POST" {action}>
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
