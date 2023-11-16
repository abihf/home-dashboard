"use client";
import { PropsWithChildren, ReactPropTypes, useEffect, useRef, useState } from "react";
import { NetUsage, StatusResponse } from "./api/status/types";

class FetchError extends Error {
  res: Response;
  constructor(msg: string, res: Response) {
    super(msg);
    this.res = res;
  }
}

export function Status() {
  const [status, setStatus] = useState<StatusResponse>();
  const abortController = useRef<AbortController>();

  async function fetchStatus() {
    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();
    const res = await fetch(`./api/status`, { method: "POST", signal: abortController.current.signal });
    if (res.status !== 200) throw new FetchError(`invalid status response: ${res.status}`, res);
    const data = await res.json();
    setStatus(data);
  }

  useEffect(() => {
    fetchStatus();
    const handler = setInterval(() => fetchStatus(), 2000);
    return () => clearInterval(handler);
  }, []);

  if (!status) {
    return <></>;
  }

  return (
    <div>
      <Progress percent={status.cpuUsage}>CPU: {status.cpuUsage.toFixed(2)}%</Progress>
      <Progress percent={status.cpuTemp}>Temperature: {status.cpuTemp.toFixed(2)}°C</Progress>
      <Progress percent={status.memUsage.percent}>Memory: {normalizeSize(status.memUsage.usage)}B</Progress>
      <Progress percent={status.diskRoot.percent}>OS Disk: {normalizeSize(status.diskRoot.usage)}B</Progress>
      <Progress percent={status.diskMedia.percent}>Media: {normalizeSize(status.diskMedia.usage)}B</Progress>
      <NetworkUsage {...status.netUsage} />
    </div>
  );
}

interface NetworkData {
  lastRx: number;
  lastTx: number;
  speedRx: number;
  speedTx: number;
  percent: number;
  lastFetch?: number;
}

function NetworkUsage({ lastRx, lastTx }: NetUsage) {
  const networkData = useRef<NetworkData>({ lastRx: 0, lastTx: 0, speedRx: 0, speedTx: 0, percent: 0 });

  const now = Date.now();
  let netUpdate = true;
  if (networkData.current.lastFetch) {
    const deltaTime = now - networkData.current.lastFetch;
    // fuck double render
    if (deltaTime > 100) {
      networkData.current.speedTx = (1000 * (lastTx - networkData.current.lastTx)) / deltaTime;
      networkData.current.speedRx = (1000 * (lastRx - networkData.current.lastRx)) / deltaTime;
      networkData.current.percent = Math.min(
        100,
        (100 * (networkData.current.speedTx + networkData.current.speedRx)) / 10_000_000
      );
    } else {
      netUpdate = false;
    }
  }
  if (netUpdate) {
    networkData.current.lastFetch = now;
    networkData.current.lastTx = lastTx;
    networkData.current.lastRx = lastRx;
  }
  return (
    <Progress percent={networkData.current.percent}>
      Up: {normalizeSize(networkData.current.speedTx)}Bps | Down {normalizeSize(networkData.current.speedRx)}Bps
    </Progress>
  );
}

const SIZE_SUFFIX = "KMGT";
function normalizeSize(size: number, digits = 2) {
  let suffixIdx = -1;
  let normalized = size;
  while (normalized > 1024) {
    normalized /= 1024;
    suffixIdx++;
  }
  const suffix = suffixIdx >= 0 ? SIZE_SUFFIX[suffixIdx] : "";
  return `${normalized.toFixed(digits)} ${suffix}`;
}

type ProgressProps = PropsWithChildren<{
  percent: number;
}>;

function Progress({ percent: progress, children }: ProgressProps) {
  return (
    <div className="relative w-full h-14 overflow-hidden bg-black/5 border-white border-2 backdrop-blur-md rounded-full my-3 shadow-lg">
      <div
        className="absolute h-14 left-0 top-0 transition-transform w-full "
        style={{
          transform: `scaleX(${progress}%)`,
          transformOrigin: "left",
          background: `linear-gradient(90deg, hsla(${130 - progress},80%,30%,100%) 0%, hsla(${
            80 - progress * 0.8
          },80%,40%,70%) 100%)`,
        }}
      ></div>
      <div
        className="absolute h-14 left-0 top-0 transition-transform w-full  bg-black/50"
        style={{
          transform: `scaleX(${100 - progress}%)`,
          transformOrigin: "right",
        }}
      ></div>
      <div className="absolute h-14 my-2 mx-5 leading-10 left-0 top-0 w-full align-middle font-bold text-2xl drop-shadow-lg">
        {children}
      </div>
    </div>
  );
}
