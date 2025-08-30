<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
	class?: string;
	onswipe: (ev: { deltaX: number }) => void;
	children: Snippet;
}
const { class: className = "", onswipe, children }: Props = $props();
const point = $state({ x: 0, y: 0 });

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
	onswipe({ deltaX });
}
</script>

<div class={className} ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
	{@render children()}
</div>
