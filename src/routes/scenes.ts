import { writable, derived as wrongDerived, type Readable } from "svelte/store";

interface SceneData {
	background: string;
	clockPos: number;
	statusPos: number;
}

const SCENE_INTERVAL = 30_000;
export const scenesData: Array<SceneData> = [
	{ background: "paragon-of-human-virtue.png", clockPos: 70, statusPos: 600 },
	{ background: "frieren.jpg", clockPos: 100, statusPos: 720 },
	{ background: "memcho.jpg", clockPos: 330, statusPos: 520 },
	{ background: "sylphiette.jpg", clockPos: 50, statusPos: 610 },
	{ background: "esdeath.jpg", clockPos: 350, statusPos: 550 },
	{ background: "kobayashi.png", clockPos: 0, statusPos: 500 },
	{ background: "adashima.jpg", clockPos: 500, statusPos: 700 },
	{ background: "kikuri.jpg", clockPos: 0, statusPos: 500 },
	{ background: "tanya.jpg", clockPos: 400, statusPos: 600 },
	{ background: "yuunanami.jpg", clockPos: 20, statusPos: 650 },
];

export const enum SwipeDir {
	LEFT = -1,
	RIGHT = 1,
}

export interface Scene extends SceneData {
	nextBackground?: string;
	nextBgOpacity?: number;
}

const enum SceneStage {
	READY,
	PREPARE,
	TRANSITION,
}

interface SceneState {
	idx: number;
	stage: SceneStage;
	dir?: SwipeDir;
}

const state = writable<SceneState>({ idx: 0, stage: SceneStage.READY });

export function startSceneChange() {
	let handler: number;
	const unsubscribeFn = state.subscribe(({ idx, stage, dir }) => {
		clearTimeout(handler);
		const nextIdx = (idx + (dir ?? 1) + scenesData.length) % scenesData.length;

		switch (stage) {
			case SceneStage.READY:
				handler = setTimeout(
					() => state.set({ idx, stage: 1 }),
					SCENE_INTERVAL,
				);
				break;

			case SceneStage.PREPARE:
				handler = setTimeout(() => state.set({ idx, stage: 2, dir }), 10);
				break;

			case SceneStage.TRANSITION:
				handler = setTimeout(() => state.set({ idx: nextIdx, stage: 0 }), 1500);
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

const derived = wrongDerived as <S, T>(
	store: Readable<S>,
	fn: (value: S) => T,
) => Readable<T>;

export const scene = derived(state, ({ idx, stage, dir }) => {
	const current = scenesData[idx];
	let scene: Scene = {
		...current,
	};
	if (stage === 0) return scene;

	const nextIdx = (idx + (dir ?? 1) + scenesData.length) % scenesData.length;
	const next = scenesData[nextIdx];
	scene = {
		...next,
		background: current.background,
		nextBackground: next.background,
		nextBgOpacity: stage === 1 ? 0 : 1,
	};
	return scene;
});
