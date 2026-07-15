import type { StatusResponse, Usage } from "./api/status/types";

export interface Status extends Omit<StatusResponse, "netUsage"> {
  upload: Usage;
  download: Usage;
}
const zero: Usage = { percent: 0, usage: 0 };

export const initialStatus: Status = {
  cpuUsage: 0,
  cpuTemp: 0,
  memUsage: zero,
  diskRoot: zero,
  diskMedia: zero,
  upload: zero,
  download: zero,
};

export function fetchStatus(set: (status: Status) => void) {
  let lastFetchMs = 0,
    lastRx = 0,
    lastTx = 0;
  const eventSource = new EventSource("/api/status");
  eventSource.addEventListener("error", (err) => console.error("status error", err));
  eventSource.addEventListener("message", (msg) => {
    const { netUsage, ...data }: StatusResponse = JSON.parse(msg.data);
    let upload: Usage = zero;
    let download: Usage = zero;
    const nowMs = Date.now();
    if (lastFetchMs) {
      const deltaMs = nowMs - lastFetchMs;
      upload = netSpeed(netUsage.lastTx, lastTx, deltaMs);
      download = netSpeed(netUsage.lastRx, lastRx, deltaMs);
    }
    lastFetchMs = nowMs;
    lastTx = netUsage.lastTx;
    lastRx = netUsage.lastRx;
    set({ ...data, upload, download });
  });
  return () => eventSource.close();
}

function netSpeed(newValue: number, oldValue: number, deltaMs: number): Usage {
  if (deltaMs <= 0) return zero;

  const diff = newValue > oldValue ? newValue - oldValue : 0;
  const speed = (diff * 1000) / deltaMs;
  return { usage: speed, percent: speed / 100_000 };
}

const SIZE_SUFFIX = "KMGT";
export function normalizeSize(size: number, digits = 2) {
  let suffixIdx = -1;
  let normalized = Number(size);
  while (normalized > 1024) {
    normalized /= 1024;
    suffixIdx++;
  }
  const suffix = suffixIdx >= 0 ? SIZE_SUFFIX[suffixIdx] : "";
  return `${normalized.toFixed(digits)} ${suffix}`;
}
