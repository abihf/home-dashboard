interface SceneData {
  background: string;
  clockPos: number;
  statusPos: number;
}

export const SCENE_INTERVAL = 20_000;
export const initialScenesData: Array<SceneData> = [
  { background: "", clockPos: 0, statusPos: 500 },
];

export enum SwipeDir {
  LEFT = -1,
  RIGHT = 1,
}

export interface Scene extends SceneData {
  nextBackground?: string;
  nextBgOpacity?: number;
}

enum SceneStage {
  LOADING,
  READY,
  PREPARE,
  TRANSITION,
}
export { SceneStage };

interface SceneState {
  idx: number;
  stage: SceneStage;
  dir?: SwipeDir;
}
export type { SceneData, SceneState };

export const initialSceneState: SceneState = { idx: 0, stage: SceneStage.LOADING };

export async function loadScenesData() {
  const response = await fetch(`/bg/list.json?t=${Date.now()}`);
  return (await response.json()) as Array<SceneData>;
}

export function nextSceneState(state: SceneState, scenesData: Array<SceneData>): SceneState {
  const nextIdx = (state.idx + (state.dir ?? 1) + scenesData.length) % scenesData.length;

  switch (state.stage) {
    case SceneStage.READY:
      return { idx: state.idx, stage: SceneStage.PREPARE };

    case SceneStage.PREPARE:
      return { idx: state.idx, stage: SceneStage.TRANSITION, dir: state.dir };

    case SceneStage.TRANSITION:
      return { idx: nextIdx, stage: SceneStage.READY };

    default:
      return state;
  }
}

export function sceneDelay(stage: SceneStage) {
  switch (stage) {
    case SceneStage.READY:
      return SCENE_INTERVAL;

    case SceneStage.PREPARE:
      return 10;

    case SceneStage.TRANSITION:
      return 1500;

    default:
      return undefined;
  }
}

export function swipeScene(state: SceneState, dir: SwipeDir): SceneState {
  return { idx: state.idx, stage: SceneStage.PREPARE, dir };
}

export function getScene(state: SceneState, scenesData: Array<SceneData>) {
  const { idx, stage, dir } = state;
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
}
