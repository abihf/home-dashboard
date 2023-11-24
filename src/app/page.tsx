"use client";

import { Clock } from "./Clock";
import { Status } from "./Status";
import { Swipable } from "../components/Swipable";
import { useScene } from "./scenes";

export default function Home() {
  const { clockPos, statusPos, background: bgImg, nextBackground: nextBgImg, nextBgOpacity, onSwipe } = useScene();
  return (
    <div className="min-h-screen w-full relative">
      <Swipable onSwipe={onSwipe} className="absolute w-full h-full left-0 top-0">
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
      </Swipable>

      <div
        className="absolute w-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${clockPos}px)`, transitionDuration: "1000ms" }}
      >
        <Clock />
      </div>

      <div
        className="absolute w-full left-0 top-0 p-3 transition-transform"
        style={{ transform: `translateY(${statusPos}px)`, transitionDuration: "1000ms" }}
      >
        <Status />
      </div>
    </div>
  );
}
