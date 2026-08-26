<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<section>
	<h2>Modify Stats Form</h2>
	<p class="muted">
		What the form asks, in the order it asks it. A field you add reaches the member form and the
		chart filters on its own.
	</p>
	{#if form?.message}
		<p class="error">{form.message}</p>
	{/if}

	<div class="table-scroll card">
		<table class="admin-table">
			<thead>
				<tr>
					<th>Order</th>
					<th>Field</th>
					<th>Kind</th>
					<th>Standing</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.fields as field (field.id)}
					<tr>
						<td>
							{#if field.active}
								<form method="POST" action="?/move" class="move-form">
									<input type="hidden" name="id" value={field.id} />
									<button
										name="direction"
										value="up"
										class="quiet move"
										aria-label={`Move ${field.name} up`}>&uarr;</button
									>
									<button
										name="direction"
										value="down"
										class="quiet move"
										aria-label={`Move ${field.name} down`}>&darr;</button
									>
								</form>
							{/if}
						</td>
						<td>{field.name}</td>
						<td>{field.kindLabel}</td>
						<td>{field.active ? 'on the form' : 'off the form'}</td>
						<td><a href={resolve('/admin/form/[id]', { id: field.id })}>Open</a></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="card">
		<h3>Add a field</h3>
		<form method="POST" action="?/add">
			<label for="field-name">What the form should ask</label>
			<input id="field-name" name="name" autocomplete="off" maxlength="40" />
			<label for="field-kind">What kind of answer it takes</label>
			<select id="field-kind" name="kind">
				<option value="choice">A choice from a list (like Gender)</option>
				<option value="multi">Pick several from a list (like Kinks)</option>
				<option value="mass">A weight (lb / kg)</option>
				<option value="length">A length (ft+in / cm)</option>
				<option value="plain">A plain number</option>
				<option value="calculated">Worked out from other fields (like BMI)</option>
			</select>
			<p class="muted">
				A choice field stays off the form until you give it options on the next page; a calculated
				one until you give it its recipe.
			</p>
			<button>Add the field</button>
		</form>
	</div>
</section>
