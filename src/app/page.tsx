"use client";

import { useEffect, useState } from "react";
import { Clock } from "./Clock";
import { Status } from "./Status";

interface Scene {
  background: string;
  clockPos: number;
  statusPos: number;
}
const scenesData: Array<Scene> = [
  { background: "kikuri.jpg", clockPos: 0, statusPos: 500 },
  { background: "sylvi.jpg", clockPos: 50, statusPos: 610 },
  { background: "kobayashi.png", clockPos: 0, statusPos: 500 },
  { background: "memcho.jpg", clockPos: 330, statusPos: 520 },
];

function useScene(): [Scene, string?, number?] {
  const [{ idx, stage }, setBg] = useState({ idx: 0, stage: 0 });
  const nextIdx = (idx + 1) % scenesData.length;

  useEffect(() => {
    let handler: NodeJS.Timeout;
    switch (stage) {
      case 0:
        handler = setTimeout(() => setBg({ idx, stage: 1 }), 30000);
        break;

      case 1:
        handler = setTimeout(() => setBg({ idx, stage: 2 }), 10);
        break;

      case 2:
        handler = setTimeout(() => setBg({ idx: nextIdx, stage: 0 }), 1500);
        break;
    }
    return () => clearTimeout(handler);
  }, [idx, stage]);

  const current = scenesData[idx];
  if (stage === 0) return [current];

  const next = scenesData[nextIdx];
  return [{ ...next, background: current.background }, next.background, stage === 1 ? 0 : 1];
}

export default function Home() {
  const [{ clockPos, statusPos, background: bgImg }, nextBgImg, nextBgOpacity] = useScene();
  return (
    <div className="min-h-screen w-full relative">
      <div className="absolute w-full h-full left-0 top-0" style={{ backgroundImage: `url("./bg/${bgImg}")` }}></div>
      {nextBgImg && (
        <div
          className="absolute w-full h-full left-0 top-0 transition-all"
          style={{
            backgroundImage: `url("./bg/${nextBgImg}")`,
            opacity: nextBgOpacity ?? 0,
            transitionDuration: "1000ms",
          }}
        ></div>
      )}

      <div
        className="absolute w-full h-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${clockPos}px)`, transitionDuration: "1000ms" }}
      >
        <Clock />
      </div>

      <div
        className="absolute w-full h-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${statusPos}px)`, transitionDuration: "1000ms" }}
      >
        <Status />
      </div>
    </div>
  );
}
