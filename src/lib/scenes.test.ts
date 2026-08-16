import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getScene,
  initialSceneState,
  initialScenesData,
  loadScenesData,
  nextSceneState,
  SCENE_INTERVAL,
  SceneStage,
  sceneDelay,
  swipeScene,
  SwipeDir,
  type SceneData,
  type SceneState,
} from "./scenes";

const scenesData: Array<SceneData> = [
  { background: "a.jpg", clockPos: 0, statusPos: 0 },
  { background: "b.jpg", clockPos: 10, statusPos: 10 },
  { background: "c.jpg", clockPos: 20, statusPos: 20 },
];

describe("initial state", () => {
  it("starts in the LOADING stage at index 0", () => {
    expect(initialSceneState).toEqual({ idx: 0, stage: SceneStage.LOADING });
  });

  it("starts with a placeholder scene", () => {
    expect(initialScenesData).toHaveLength(1);
  });
});

describe("nextSceneState", () => {
  it("ignores transitions while LOADING", () => {
    const state: SceneState = { idx: 1, stage: SceneStage.LOADING };
    expect(nextSceneState(state, scenesData)).toBe(state);
  });

  it("moves from READY to PREPARE keeping the index", () => {
    const state: SceneState = { idx: 1, stage: SceneStage.READY };
    expect(nextSceneState(state, scenesData)).toEqual({ idx: 1, stage: SceneStage.PREPARE });
  });

  it("moves from PREPARE to TRANSITION keeping the index and direction", () => {
    const state: SceneState = { idx: 1, stage: SceneStage.PREPARE, dir: SwipeDir.LEFT };
    expect(nextSceneState(state, scenesData)).toEqual({
      idx: 1,
      stage: SceneStage.TRANSITION,
      dir: SwipeDir.LEFT,
    });
  });

  it("moves from TRANSITION to READY advancing the index", () => {
    const state: SceneState = { idx: 1, stage: SceneStage.TRANSITION };
    expect(nextSceneState(state, scenesData)).toEqual({ idx: 2, stage: SceneStage.READY });
  });

  it("wraps the index around the end of the list", () => {
    const state: SceneState = { idx: 2, stage: SceneStage.TRANSITION };
    expect(nextSceneState(state, scenesData)).toEqual({ idx: 0, stage: SceneStage.READY });
  });

  it("wraps the index around the start when swiping left", () => {
    const state: SceneState = { idx: 0, stage: SceneStage.TRANSITION, dir: SwipeDir.LEFT };
    expect(nextSceneState(state, scenesData)).toEqual({ idx: 2, stage: SceneStage.READY });
  });
});

describe("sceneDelay", () => {
  it("returns the scene interval when READY", () => {
    expect(sceneDelay(SceneStage.READY)).toBe(SCENE_INTERVAL);
  });

  it("returns a short delay when preparing", () => {
    expect(sceneDelay(SceneStage.PREPARE)).toBe(10);
  });

  it("returns the transition duration when transitioning", () => {
    expect(sceneDelay(SceneStage.TRANSITION)).toBe(1500);
  });

  it("returns undefined while LOADING", () => {
    expect(sceneDelay(SceneStage.LOADING)).toBeUndefined();
  });
});

describe("swipeScene", () => {
  it("forces the PREPARE stage with the given direction", () => {
    const state: SceneState = { idx: 1, stage: SceneStage.READY };
    expect(swipeScene(state, SwipeDir.LEFT)).toEqual({
      idx: 1,
      stage: SceneStage.PREPARE,
      dir: SwipeDir.LEFT,
    });
  });
});

describe("getScene", () => {
  it("returns the current scene while LOADING or READY", () => {
    for (const stage of [SceneStage.LOADING, SceneStage.READY]) {
      const scene = getScene({ idx: 1, stage }, scenesData);
      expect(scene).toEqual(scenesData[1]);
      expect(scene.nextBackground).toBeUndefined();
    }
  });

  it("overlays the next scene while PREPARE", () => {
    const scene = getScene({ idx: 0, stage: SceneStage.PREPARE }, scenesData);
    expect(scene).toEqual({
      ...scenesData[1],
      background: "a.jpg",
      nextBackground: "b.jpg",
      nextBgOpacity: 0,
    });
  });

  it("fades the next scene in during TRANSITION", () => {
    const scene = getScene({ idx: 0, stage: SceneStage.TRANSITION }, scenesData);
    expect(scene).toEqual({
      ...scenesData[1],
      background: "a.jpg",
      nextBackground: "b.jpg",
      nextBgOpacity: 1,
    });
  });

  it("uses the swipe direction to pick the next scene", () => {
    const scene = getScene({ idx: 0, stage: SceneStage.PREPARE, dir: SwipeDir.LEFT }, scenesData);
    expect(scene.nextBackground).toBe("c.jpg");
    expect(scene.clockPos).toBe(20);
  });
});

describe("loadScenesData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses the background list", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(scenesData)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadScenesData()).resolves.toEqual(scenesData);
    expect(fetchMock).toHaveBeenCalledWith("/bg/list.json");
  });
});
