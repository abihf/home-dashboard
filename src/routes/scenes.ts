import { writable, derived } from "svelte/store";

interface SceneData {
	background: string;
	clockPos: number;
	statusPos: number;
}

const SCENE_INTERVAL = 2_000;
let scenesData: Array<SceneData> = [{ background: "", clockPos: 0, statusPos: 500 }];

export const enum SwipeDir {
	LEFT = -1,
	RIGHT = 1,
}

export interface Scene extends SceneData {
	nextBackground?: string;
	nextBgOpacity?: number;
}

const enum SceneStage {
	LOADING,
	READY,
	PREPARE,
	TRANSITION,
}

interface SceneState {
	idx: number;
	stage: SceneStage;
	dir?: SwipeDir;
}

const state = writable<SceneState>({ idx: 0, stage: SceneStage.LOADING });

export function startSceneChange() {
	fetch("/bg/list.json?t=" + Date.now())
		.then((res) => res.json())
		.then((data) => {
			scenesData = data;
			state.set({ idx: 0, stage: SceneStage.READY });
		});
	let handler: number;
	const unsubscribeFn = state.subscribe(({ idx, stage, dir }) => {
		clearTimeout(handler);
		const nextIdx = (idx + (dir ?? 1) + scenesData.length) % scenesData.length;

		switch (stage) {
			case SceneStage.READY:
				handler = setTimeout(
					() => state.set({ idx, stage: SceneStage.PREPARE }),
					SCENE_INTERVAL,
				);
				break;

			case SceneStage.PREPARE:
				handler = setTimeout(() => state.set({ idx, stage: SceneStage.TRANSITION, dir }), 10);
				break;

			case SceneStage.TRANSITION:
				handler = setTimeout(() => state.set({ idx: nextIdx, stage: SceneStage.READY }), 1500);
				break;
		}
	});

	return () => {
		unsubscribeFn();
		clearTimeout(handler);
	};
}

export function swipeScene(dir: SwipeDir) {
	state.update((cur) => ({ idx: cur.idx, stage: SceneStage.PREPARE, dir }));
}

export const scene = derived(state, ({ idx, stage, dir }) => {
	const current = scenesData[idx];
	let scene: Scene = {
		...current,
	};
	if (stage === SceneStage.LOADING || stage === SceneStage.READY) return scene;

	const nextIdx = (idx + (dir ?? 1) + scenesData.length) % scenesData.length;
	const next = scenesData[nextIdx];
	scene = {
		...next,
		background: current.background,
		nextBackground: next.background,
		nextBgOpacity: stage === SceneStage.PREPARE ? 0 : 1,
	};
	return scene;
});
