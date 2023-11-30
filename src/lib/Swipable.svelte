<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	export let className: string = '';
	let point = { x: 0, y: 0 };

	interface Events {
		swipe: { deltaX: number };
	}

	const dispatch = createEventDispatcher<Events>();
	function handleTouchStart(ev: TouchEvent) {
		if (ev.targetTouches.length !== 1) return ev.preventDefault();
		const touch = ev.targetTouches.item(0)!;
		point.x = touch.pageX;
		point.y = touch.pageY;
	}
	function handleTouchEnd(ev: TouchEvent) {
		if (ev.changedTouches.length !== 1) return ev.preventDefault();
		const touch = ev.changedTouches.item(0)!;
		const deltaX = touch.pageX - point.x;
		const deltaY = touch.pageY - point.y;
		if (deltaX === 0 || Math.abs(deltaX) < Math.abs(deltaY)) return;
		dispatch('swipe', { deltaX });
	}
</script>

<div class={className} on:touchstart={handleTouchStart} on:touchend={handleTouchEnd}>
	<slot />
</div>
