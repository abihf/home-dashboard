<script>
import "../app.css";

let { children } = $props();
</script>

<div class="h-full w-full relative overflow-hidden text-white">
	{@render children()}
</div>
