<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<!-- The in-page brand pair on the phone (the desktop top bar carries
     it instead and this hides there): site name plus Binder, and a
     way home (owner, 2026-08-24). -->
<a class="wordmark" href={resolve('/home')}>
	<span>{page.data.siteName}</span>
	<span class="wordmark-sub">Binder</span>
</a>
