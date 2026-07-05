<script lang="ts">
import type { Snippet } from "svelte";
import { css } from "$lib/css";

let {
	percent,
	className = "",
	icon,
	children,
}: {
	percent: number;
	className?: string;
	icon?: Snippet;
	children?: Snippet;
} = $props();

let value = $derived(Math.min(percent, 100));
</script>

<div
	role="progressbar"
	aria-valuenow={value}
	class={`relative w-full h-16 overflow-hidden bg-black/5 border-white border-2 backdrop-blur-md rounded-full shadow-lg ${className}`}
>
	<div
		class="absolute h-16 left-0 top-0 transition-transform w-full"
		style={css({
			transform: `scaleX(${value / 100})`,
			transformOrigin: 'left',
			background: `linear-gradient(90deg, hsla(${130 - value},80%,30%,100%) 0%, hsla(${
				80 - value * 0.8
			},80%,40%,70%) 100%)`
		})}
	></div>
	<div
		class="absolute h-16 left-0 top-0 transition-transform w-full bg-black/40"
		style={css({
			transform: `scaleX(${1 - value / 100})`,
			transformOrigin: 'right'
		})}
	></div>
	<div
		class="absolute rounded-full p-3 flex justify-center items-center left-0 top-0 bg-black/30"
		style={css({ width: '60px', height: '60px' })}
	>
		{#if icon}
			{@render icon()}
		{/if}
	</div>
	<div
		class="absolute h-16 my-2 ml-16 leading-10 left-0 top-0 align-middle text-4xl font-semibold drop-shadow-lg"
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
