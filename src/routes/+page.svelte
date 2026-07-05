<script lang="ts">
import Swipable from "$lib/Swipable.svelte";
import Clock from "./Clock.svelte";
import Status from "./Status.svelte";
import {
	getScene,
	initialSceneState,
	initialScenesData,
	loadScenesData,
	sceneDelay,
	SceneStage,
	SwipeDir,
	nextSceneState,
	swipeScene,
} from "./scenes";

let scenesData = $state(initialScenesData);
let sceneState = $state(initialSceneState);
const scene = $derived.by(() => getScene(sceneState, scenesData));

$effect(() => {
	let active = true;

	loadScenesData().then((data) => {
		if (!active) return;
		scenesData = data;
		sceneState = { idx: 0, stage: SceneStage.READY };
	});

	return () => {
		active = false;
	};
});

$effect(() => {
	const delay = sceneDelay(sceneState.stage);
	if (delay === undefined) return;

	const snapshot = { idx: sceneState.idx, stage: sceneState.stage, dir: sceneState.dir };
	const handler = setTimeout(() => {
		sceneState = nextSceneState(snapshot, scenesData);
	}, delay);

	return () => clearTimeout(handler);
});

function handleSwipe(ev: { deltaX: number }) {
	sceneState = swipeScene(sceneState, ev.deltaX > 0 ? SwipeDir.LEFT : SwipeDir.RIGHT);
}
</script>

<Swipable class="absolute w-full h-full left-0 top-0" onswipe={handleSwipe}>
	<div
		class="absolute w-full h-full left-0 top-0"
		style={`background-image: url('./bg/${scene.background}')`}
	></div>
	{#if scene.nextBackground}
		<div
			class="absolute w-full h-full left-0 top-0 transition-all transition-1s"
			style={`background-image: url('./bg/${scene.nextBackground}'); opacity: ${scene.nextBgOpacity ?? 0}`}
		></div>
	{/if}
</Swipable>
<div
	class="absolute w-full left-0 top-0 p-3 transition-transform transition-1s"
	style={`transform: translateY(${scene.clockPos}px)`}
>
	<Clock />
</div>
<div
	class="absolute w-full left-0 top-0 p-3 transition-transform transition-1s"
	style={`transform: translateY(${scene.statusPos}px)`}
>
	<Status />
</div>

<style>
	.transition-1s {
		transition-duration: 1s;
	}
</style>
