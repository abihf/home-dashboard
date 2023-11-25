<script>
	import { onMount } from 'svelte';
	import Clock from './Clock.svelte';
	import Status from './Status.svelte';
	import { handleMount, scene } from './scenes';
	import { createEventSource } from '$lib/eventSource';

	onMount(handleMount);
	onMount(() => {
		const reloader = createEventSource('/api/reload');
		return reloader.subscribe((msg) => {
			if (msg?.time) location.reload();
		});
	});
</script>

<div class="absolute w-full h-full left-0 top-0">
	<div
		class="absolute w-full h-full left-0 top-0"
		style="background-image: url('./bg/{$scene.background}')"
	></div>
	{#if $scene.nextBackground}
		<div
			class="absolute w-full h-full left-0 top-0 transition-all transition-1s"
			style="background-image: url('./bg/{$scene.nextBackground}'); opacity: {$scene.nextBgOpacity ??
				0}"
		></div>
	{/if}
</div>
<div
	class="absolute w-full left-0 top-0 p-3 transition-transform transition-1s"
	style="transform: translateY({$scene.clockPos}px)"
>
	<Clock />
</div>
<div
	class="absolute w-full left-0 top-0 p-3 transition-transform transition-1s"
	style="transform: translateY({$scene.statusPos}px)"
>
	<Status />
</div>

<style>
	.transition-1s {
		transition-duration: 1s;
	}
</style>
