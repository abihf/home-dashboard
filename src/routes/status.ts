import type { StatusResponse, Usage } from "./api/status/types";

export interface Status extends Omit<StatusResponse, "netUsage"> {
  upload: Usage;
  download: Usage;
}
const zero: Usage = { percent: 0, usage: 0n };

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
  let lastFetchMs: bigint, lastRx: bigint, lastTx: bigint;
  const eventSource = new EventSource("/api/status");
  eventSource.addEventListener("error", (err) => console.error("status error", err));
  eventSource.addEventListener("message", (msg) => {
    const { netUsage, ...data }: StatusResponse = JSON.parse(msg.data, parseBigIntReviver);
    let upload: Usage = zero;
    let download: Usage = zero;
    const nowMs = BigInt(Date.now());
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

function netSpeed(newValue: bigint, oldValue: bigint, deltaMs: bigint): Usage {
  if (deltaMs <= 0n) return zero;

  const diff = newValue > oldValue ? newValue - oldValue : 0n;
  const speed = (diff * 1000n) / deltaMs;
  return { usage: speed, percent: Number(speed) / 100_000 };
}

const SIZE_SUFFIX = "KMGT";
export function normalizeSize(size: bigint | number, digits = 2) {
  let suffixIdx = -1;
  let normalized = Number(size);
  while (normalized > 1024) {
    normalized /= 1024;
    suffixIdx++;
  }
  const suffix = suffixIdx >= 0 ? SIZE_SUFFIX[suffixIdx] : "";
  return `${normalized.toFixed(digits)} ${suffix}`;
}

function parseBigIntReviver(_: string, value: unknown) {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}
