<script lang="ts">
	import Brand from '$lib/Brand.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Nav from '$lib/Nav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The units toggle carries ?u= for one page view, filters intact;
	// the static script strips it after render (owner ruling
	// 2026-08-26).
	const unitsHref = (u: string) => {
		const params = new SvelteURLSearchParams(page.url.search);
		params.set('u', u);
		return `${page.url.pathname}?${params.toString()}`;
	};
</script>

<svelte:head>
	<title>{data.siteName} Binder — {data.focus.name}</title>
	<script src="/units-view.js" defer></script>
</svelte:head>

<Nav active="charts" />
<main class="wide with-rail">
	<div class="page-head">
		<div>
			<Brand />
			<h1>{data.focus.name}</h1>
		</div>
	</div>

	<div class="focus-layout">
		<div class="side">
			<ul class="fieldlist card">
				{#each data.fieldList as f (f.id)}
					<li>
						<a href={resolve('/charts/[field]', { field: f.id })} class:on={f.id === data.fieldId}
							>{f.name}</a
						>
					</li>
				{/each}
			</ul>

			{#if data.focus.filterFields.length}
				<form method="GET" class="filters card">
					<p class="filters-title">Show only</p>
					{#each data.focus.filterFields as filter (filter.id)}
						{#if filter.multiple}
							<!-- Pick-several fields filter as checkboxes: only people
							     whose picks include EVERY ticked option show. -->
							<fieldset class="picks filter-picks">
								<legend>{filter.name}</legend>
								{#each filter.options as option (option)}
									<label class="pick">
										<input
											type="checkbox"
											name={'f_' + filter.id}
											value={option}
											checked={filter.selected.includes(option)}
										/>
										<span>{option}</span>
									</label>
								{/each}
							</fieldset>
						{:else}
							<label class="sr-only" for={'filter-' + filter.id}>{filter.name}</label>
							<select id={'filter-' + filter.id} name={'f_' + filter.id}>
								<option value="">Any {filter.name.toLowerCase()}</option>
								{#each filter.options as option (option)}
									<option value={option} selected={filter.selected[0] === option}>{option}</option>
								{/each}
							</select>
						{/if}
					{/each}
					<button>Apply</button>
				</form>
			{/if}
		</div>

		<div class="charts-col">
			{#if data.hasUnits}
				<nav class="units">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- the same page with ?u= swapped; the path is the page's own -->
					<a
						href={unitsHref('imperial')}
						class:on={data.units === 'imperial'}
						aria-current={data.units === 'imperial'}>Imperial (US)</a
					>
					<a
						href={unitsHref('metric')}
						class:on={data.units === 'metric'}
						aria-current={data.units === 'metric'}>Metric</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</nav>
			{/if}
			<div class="stats-row">
				{#each data.focus.stats as stat (stat.label)}
					<div class="stat card">
						<p class="stat-label">{stat.label}</p>
						<p class="stat-value" class:accent={stat.accent}>{stat.value}</p>
					</div>
				{/each}
			</div>

			{#if data.focus.empty}
				<p class="muted">{data.focus.empty}</p>
			{/if}

			{#if data.focus.counts.length}
				<section class="card">
					<h2>Counts</h2>
					<div class="countbars">
						{#each data.focus.counts as row (row.label)}
							<div class="countbar">
								<p class="countbar-label">{row.label}</p>
								<div class="countbar-track">
									<div class="countbar-fill" style={`width: ${row.pct}%`}></div>
								</div>
								<p class="countbar-n">{row.count}</p>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if data.focus.trend}
				<section class="card">
					<h2>Trend</h2>
					<svg
						class="trend-svg"
						viewBox="0 0 600 220"
						role="img"
						aria-label={data.focus.name + ' trend'}
					>
						<line x1="40" y1="14" x2="590" y2="14" stroke="#4a3a4033" stroke-width="1"></line>
						<line x1="40" y1="110" x2="590" y2="110" stroke="#4a3a4033" stroke-width="1"></line>
						<line x1="40" y1="206" x2="590" y2="206" class="axis"></line>
						<text x="0" y="18" class="axis-text">{data.focus.trend.yMax}</text>
						<text x="0" y="114" class="axis-text">{data.focus.trend.yMid}</text>
						<text x="0" y="210" class="axis-text">{data.focus.trend.yMin}</text>
						{#if data.focus.trend.ghost}
							<polyline class="ghost" points={data.focus.trend.ghost} />
						{/if}
						<polyline class="line" points={data.focus.trend.poly} />
					</svg>
					<div class="axis-row">
						<p>{data.focus.trend.xFirst}</p>
						{#if data.focus.trend.ghost}
							<p class="legend">
								<span class="legend-line"></span> filtered &nbsp;
								<span class="legend-ghost"></span> whole group
							</p>
						{/if}
						<p>{data.focus.trend.xLast}</p>
					</div>
				</section>
			{/if}

			{#if data.focus.dist}
				<section class="card">
					<h2>Where everyone sits</h2>
					<div class="dist">
						{#each data.focus.dist.bars as bar, i (i)}
							<!-- The bar IS the information: focus or tap opens its range
							     bubble without JavaScript. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="dist-bar"
								class:on={bar.on}
								style={`height: ${bar.pct}%`}
								tabindex="0"
								role="img"
								aria-label={bar.label}
								data-label={bar.label}
							></div>
						{/each}
					</div>
					<div class="axis-row">
						<p>{data.focus.dist.from}</p>
						{#if data.focus.dist.you}
							<p class="you">{data.focus.dist.you}</p>
						{/if}
						<p>{data.focus.dist.to}</p>
					</div>
				</section>
			{/if}
		</div>
	</div>

	<p class="back-to-board"><a href={resolve('/charts')}>&larr; All stats</a></p>
</main>
