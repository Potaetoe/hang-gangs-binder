<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Nav from '$lib/Nav.svelte';

	let { data, children }: { data: { pendingCount: number }; children: import('svelte').Snippet } =
		$props();

	const sections = [
		{ path: '/admin/members', name: 'Members' },
		{ path: '/admin/form', name: 'Modify Stats Form' },
		{ path: '/admin/events', name: 'Events' },
		{ path: '/admin/settings', name: 'Settings' },
		{ path: '/admin/log', name: 'Change log' },
		{ path: '/admin/corrections', name: 'Corrections' }
	] as const;
	const active = $derived(page.url.pathname);
</script>

<Nav active="admin" />
<main class="wide with-rail">
	<p class="wordmark">{page.data.siteName}</p>
	<!-- The rail already says where you are (owner ruling 2026-08-26);
	     the heading stays for screen readers only. -->
	<h1 class="sr-only">Admin</h1>

	<div class="focus-layout">
		<div class="side">
			<ul class="fieldlist card">
				{#each sections as section (section.path)}
					<li>
						<a href={resolve(section.path)} class:on={active.startsWith(section.path)}
							>{section.name}{section.name === 'Members' && data.pendingCount
								? ` (${data.pendingCount} waiting)`
								: ''}</a
						>
					</li>
				{/each}
			</ul>
		</div>
		<div class="charts-col">
			{@render children()}
		</div>
	</div>
</main>
