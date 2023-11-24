"use client";
import { memo, useEffect, useLayoutEffect, useState } from "react";

export const Clock = memo(function Clock() {
  const [time, setTime] = useState<Date>();
  useLayoutEffect(() => setTime(new Date()), []);
  useEffect(() => {
    const handler = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(handler);
  }, []);

  return (
    <div className="mb-5 text-center bg-black/50 rounded-xl border-white border-2 p-2 backdrop-blur-lg shadow-lg">
      <p className="text-4xl font-mono mb-2 font-semibold drop-shadow-lg">
        {time?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
      </p>
      <p className="text-7xl font-mono font-bold drop-shadow-lg">
        {time?.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
    </div>
  );
});
