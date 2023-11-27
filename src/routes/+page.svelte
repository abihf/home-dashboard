<script lang="ts">
	import Clock from './Clock.svelte';
	import Status from './Status.svelte';
	import { handleMount, scene, swipeScene } from './scenes';
	import { createEventSource } from '$lib/eventSource';
	import Swipable from '$lib/Swipable.svelte';
	$effect(handleMount);
	$effect(() => {
		const reloader = createEventSource('/api/reload');
		return reloader.subscribe((msg) => {
			if (msg?.time) location.reload();
		});
	});
	function handleSwipe(ev: CustomEvent<{ deltaX: number }>) {
		swipeScene(ev.detail.deltaX > 0 ? -1 : 1);
	}
</script>

<Swipable className="absolute w-full h-full left-0 top-0" on:swipe={handleSwipe}>
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
</Swipable>
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
