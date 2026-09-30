<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<!-- The brand and a way home on the phone. The desktop top bar carries
     it instead, so this hides there. -->
<a class="wordmark" href={resolve('/home')}>
	<span>{page.data.siteName}</span>
	<span class="wordmark-sub">Binder</span>
</a>
