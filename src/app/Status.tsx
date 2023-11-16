"use client";
import { PropsWithChildren, ReactElement, ReactNode, ReactPropTypes, useEffect, useRef, useState } from "react";
import { NetUsage, StatusResponse } from "./api/status/types";
import { CpuIcon } from "../icons/CpuIcon";
import { FireIcon } from "../icons/FireIcon";
import { ComputerIcon } from "../icons/ComputerIcon";
import { DiskIcon } from "../icons/DiskIcon";
import { FilmIcon } from "../icons/FilmIcon";
import { DownloadIcon } from "../icons/DownloadIcon";
import { UploadIcon } from "../icons/UploadIcon";

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
    <div className="grid grid-cols-2 gap-4">
      <Progress percent={status.cpuUsage} icon={<CpuIcon />}>
        {status.cpuUsage.toFixed(2)}%
      </Progress>
      <Progress percent={status.cpuTemp} icon={<FireIcon />}>
        {status.cpuTemp.toFixed(2)}°C
      </Progress>
      <Progress percent={status.memUsage.percent} icon={<ComputerIcon />} className="col-span-2">
        {normalizeSize(status.memUsage.usage)}B
      </Progress>
      <Progress percent={status.diskRoot.percent} icon={<DiskIcon />}>
        {normalizeSize(status.diskRoot.usage)}B
      </Progress>
      <Progress percent={status.diskMedia.percent} icon={<FilmIcon />}>
        {normalizeSize(status.diskMedia.usage)}B
      </Progress>
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
    <>
      <Progress percent={networkData.current.speedRx / 100_000} icon={<DownloadIcon />}>
        {normalizeSize(networkData.current.speedRx)}Bps
      </Progress>
      <Progress percent={networkData.current.speedTx / 100_000} icon={<UploadIcon />}>
        {normalizeSize(networkData.current.speedTx)}Bps
      </Progress>
    </>
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
  icon?: ReactNode;
  className?: string;
}>;

function Progress({ percent, children, icon = "", className = "" }: ProgressProps) {
  if (percent > 100) {
    percent = 100;
  }

  return (
    <div
      className={`relative w-full h-14 overflow-hidden bg-black/5 border-white border-2 backdrop-blur-md rounded-full shadow-lg ${className}`}
    >
      <div
        className="absolute h-14 left-0 top-0 transition-transform w-full "
        style={{
          transform: `scaleX(${percent}%)`,
          transformOrigin: "left",
          background: `linear-gradient(90deg, hsla(${130 - percent},80%,30%,100%) 0%, hsla(${
            80 - percent * 0.8
          },80%,40%,70%) 100%)`,
        }}
      ></div>
      <div
        className="absolute h-14 left-0 top-0 transition-transform w-full  bg-black/50"
        style={{
          transform: `scaleX(${100 - percent}%)`,
          transformOrigin: "right",
        }}
      ></div>
      <div
        className="absolute rounded-full p-2 flex justify-center items-center left-0 top-0 bg-slate-800/50"
        style={{ width: 52, height: 52 }}
      >
        {icon}
      </div>
      <div className="absolute h-14 my-2 ml-16 leading-10 left-0 top-0 align-middle font-bold text-2xl drop-shadow-lg">
        {children}
      </div>
    </div>
  );
}
