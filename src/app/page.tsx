"use client";

import { Clock } from "./Clock";
import { Status } from "./Status";
import { useEffect, useLayoutEffect, useState } from "react";

interface BgData {
  image: string;
  clockPos: number;
  statusPos: number;
}
const backgroundData: Array<BgData> = [
  { image: "kikuri.jpg", clockPos: 0, statusPos: 500 },
  { image: "sylvi.jpg", clockPos: 50, statusPos: 570 },
  { image: "kobayashi.png", clockPos: 0, statusPos: 500 },
  { image: "memcho.jpg", clockPos: 330, statusPos: 520 },
];

function useBg(): [BgData, string?, number?] {
  const [{ idx, stage }, setBg] = useState({ idx: 0, stage: 0 });
  const nextIdx = (idx + 1) % backgroundData.length;

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

  const currentBg = backgroundData[idx];
  if (stage === 0) return [currentBg];

  const nextBg = backgroundData[nextIdx];
  return [{ ...nextBg, image: currentBg.image }, nextBg.image, stage === 1 ? 0 : 1];
}

export default function Home() {
  const [{ clockPos, statusPos, image }, nextBgImg, nextBgOpacity] = useBg();
  return (
    <div className="min-h-screen w-full relative">
      <div className="absolute w-full h-full left-0 top-0" style={{ backgroundImage: `url("./bg/${image}")` }}></div>
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
    // <main className="flex min-h-screen flex-col items-center justify-between p-6">
    //   <div className="grid text-center w-full transition-transform">
    //       <Clock />
    //       <Status />
    //   </div>
    // </main>
  );
}
