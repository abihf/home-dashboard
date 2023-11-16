"use client";

import { Clock } from "./Clock";
import { Status } from "./Status";
import { useEffect, useLayoutEffect, useState } from "react";

const backgroundData: Array<{ image: string; clockPos: number; statusPos: number }> = [
  { image: "kikuri.jpg", clockPos: 0, statusPos: 500 },
  { image: "sylvi.jpg", clockPos: 50, statusPos: 570 },
  { image: "kobayashi.png", clockPos: 0, statusPos: 500 },
  { image: "memcho.jpg", clockPos: 330, statusPos: 520 },
];

export default function Home() {
  const [index, setIndex] = useState(0);
  function updateBg() {
    const newIndex = (index + 1) % backgroundData.length;
    const { image } = backgroundData[newIndex];
    document.body.style.backgroundImage = `url("/bg/${image}")`;
    setIndex(newIndex);
  }
  useLayoutEffect(updateBg, []);

  useEffect(() => {
    // document.documentElement.requestFullscreen();
    const handler = setInterval(updateBg, 30000);
    return () => clearInterval(handler);
  }, [index]);

  const { clockPos, statusPos } = backgroundData[index];

  return (
    <div className="min-h-screen w-full relative">
      <div
        className="absolute w-full h-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${clockPos}px)` }}
      >
        <Clock />
      </div>
      <div
        className="absolute w-full h-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${statusPos}px)` }}
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
