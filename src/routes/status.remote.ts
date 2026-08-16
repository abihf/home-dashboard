import { query } from "$app/server";
import { createMetricsReader, query as queryStatus, type Usage } from "#lib/monitor.ts";

const defaultReader = createMetricsReader();

export const getStatus = query.live(async function* () {
  let lastFetchMs: number | undefined;
  let lastRx: number | undefined;
  let lastTx: number | undefined;
  while (true) {
    try {
      const { netUsage, ...status } = await queryStatus(defaultReader);
      const now = Date.now();
      const deltaMs = lastFetchMs && now - lastFetchMs;
      const upload = netSpeed(netUsage.lastTx, lastTx, deltaMs);
      const download = netSpeed(netUsage.lastRx, lastRx, deltaMs);

      lastFetchMs = now;
      lastRx = netUsage.lastRx;
      lastTx = netUsage.lastTx;
      yield { ...status, upload, download };
    } catch (error) {
      console.error("Error reading status:", error);
    }
    await Bun.sleep(1000);
  }
});

const zero = { percent: 0, usage: 0 };

function netSpeed(newValue: number, oldValue?: number, deltaMs?: number): Usage {
  if (!oldValue || !deltaMs || deltaMs <= 0) return zero;

  const diff = newValue > oldValue ? newValue - oldValue : 0;
  const speed = (diff * 1000) / deltaMs;
  return { usage: speed, percent: speed / 100_000 };
}
