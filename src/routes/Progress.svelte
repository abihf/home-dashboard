<script lang="ts">
	import { css } from '$lib/css';

	export let percent: number;
	export let className: string = '';

	$: if (percent > 100) percent = 100;
</script>

<div
	class={`relative w-full h-16 overflow-hidden bg-black/5 border-white border-2 backdrop-blur-md rounded-full shadow-lg ${className}`}
>
	<div
		class="absolute h-16 left-0 top-0 transition-transform w-full"
		style={css({
			transform: `scaleX(${percent / 100})`,
			transformOrigin: 'left',
			background: `linear-gradient(90deg, hsla(${130 - percent},80%,30%,100%) 0%, hsla(${
				80 - percent * 0.8
			},80%,40%,70%) 100%)`
		})}
	></div>
	<div
		class="absolute h-16 left-0 top-0 transition-transform w-full bg-black/40"
		style={css({
			transform: `scaleX(${1 - percent / 100})`,
			transformOrigin: 'right'
		})}
	></div>
	<div
		class="absolute rounded-full p-3 flex justify-center items-center left-0 top-0 bg-black/30"
		style={css({ width: '60px', height: '60px' })}
	>
		<slot name="icon" />
	</div>
	<div
		class="absolute h-16 my-2 ml-16 leading-10 left-0 top-0 align-middle text-4xl font-semibold drop-shadow-lg"
	>
		<slot />
	</div>
</div>
