"use client";
import { useEffect, useLayoutEffect, useState } from "react";

export function Clock() {
  const [time, setTime] = useState<Date>();
  useLayoutEffect(() => setTime(new Date()), []);
  useEffect(() => {
    const handler = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(handler);
  }, []);

  return (
    <div className="mb-5 text-center bg-black/50 rounded-xl border-white border-2 p-5 backdrop-blur-lg shadow-lg">
      <p className="text-3xl mb-5 font-semibold drop-shadow-lg">
        {time?.toLocaleDateString(undefined, { dateStyle: "full" })}
      </p>
      <p className="text-7xl font-mono font-bold drop-shadow-lg">{time?.toLocaleTimeString()}</p>
    </div>
  );
}
