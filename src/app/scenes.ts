import { useCallback, useEffect, useState } from "react";
import { OnSwipe, SwipeDir } from "../components/Swipable";

interface SceneData {
  background: string;
  clockPos: number;
  statusPos: number;
}

const SCENE_INTERVAL = 15_000;
const scenesData: Array<SceneData> = [
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

interface Scene extends SceneData {
  nextBackground?: string;
  nextBgOpacity?: number;
  onSwipe: OnSwipe;
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

export function useScene(): Scene {
  const [{ idx, stage, dir }, setBg] = useState<SceneState>({ idx: 0, stage: SceneStage.READY });
  const nextIdx = (idx + (dir ?? 1) + scenesData.length) % scenesData.length;
  const onSwipe = useCallback<OnSwipe>((dir) => setBg({ idx: idx, stage: SceneStage.PREPARE, dir }), [idx]);

  useEffect(() => {
    let handler: NodeJS.Timeout;
    switch (stage) {
      case SceneStage.READY:
        handler = setTimeout(() => setBg({ idx, stage: 1 }), SCENE_INTERVAL);
        break;

      case SceneStage.PREPARE:
        handler = setTimeout(() => setBg({ idx, stage: 2, dir }), 10);
        break;

      case SceneStage.TRANSITION:
        handler = setTimeout(() => setBg({ idx: nextIdx, stage: 0 }), 1500);
        break;
    }
    return () => clearTimeout(handler);
  }, [idx, nextIdx, stage, dir]);

  const current = scenesData[idx];
  if (stage === 0) return { ...current, onSwipe };

  const next = scenesData[nextIdx];
  return {
    ...next,
    background: current.background,
    onSwipe,
    nextBackground: next.background,
    nextBgOpacity: stage === 1 ? 0 : 1,
  };
}
