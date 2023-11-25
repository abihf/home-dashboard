<svelte:options runes={true} />

<script lang="ts">
	let now = $state(new Date());

	$effect(() => {
		const handler = setInterval(() => {
			now = new Date();
		}, 100);
		return () => clearInterval(handler);
	});
</script>

<div
	title="Date time"
	class="mb-5 text-center bg-black/50 rounded-xl border-white border-2 p-2 backdrop-blur-lg shadow-lg"
>
	<p class="text-4xl font-mono mb-2 font-semibold drop-shadow-lg">
		{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
	</p>
	<p class="text-7xl font-mono font-bold drop-shadow-lg">
		{now.toLocaleTimeString(undefined, {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})}
	</p>
</div>
