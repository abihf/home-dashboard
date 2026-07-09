import type { NetUsage, StatusResponse, Usage } from "./types";
import type { RequestHandler } from "@sveltejs/kit";
interface CpuSample {
  idle: number;
  total: number;
}

let previousCpuSample: CpuSample | undefined;

async function query() {
  const [cpuUsage, memUsage, disk, cpuTemp, netUsage] = await Promise.all([
    readCpuUsage(),
    readMemUsage(),
    readDiskUsage("/", "/media/data"),
    readCpuTemperature(),
    readNetUsage("eth1"),
  ]);

  const status: StatusResponse = {
    cpuUsage,
    cpuTemp,
    memUsage,
    diskRoot: disk["/"] ?? { usage: 0n, percent: 0 },
    diskMedia: disk["/media/data"] ?? { usage: 0n, percent: 0 },
    netUsage,
  };
  return status;
}

export const GET: RequestHandler = async () => {
  let handler: ReturnType<typeof setInterval>;
  let canceled = false;

  const stream = new ReadableStream({
    start(controller) {
      async function queryAndUpdate() {
        try {
          const data = await query();
          const json = serializeWithBigInt(data);
          if (!canceled) controller.enqueue(`data: ${json}\n\n`);
        } catch (error) {
          console.error("Error querying metrics:", error);
          if (!canceled) controller.enqueue("event: error\\ndata: metrics read failed\\n\\n");
        }
      }
      handler = setInterval(queryAndUpdate, 1000);
      void queryAndUpdate();
    },
    cancel() {
      canceled = true;
      clearInterval(handler);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
    },
  });
};

async function readCpuUsage(): Promise<number> {
  const current = await parseCpuSample(readLines("/proc/stat"));
  if (!current) return 0;

  if (!previousCpuSample) {
    previousCpuSample = current;
    return 0;
  }

  const totalDelta = current.total - previousCpuSample.total;
  const idleDelta = current.idle - previousCpuSample.idle;
  previousCpuSample = current;

  if (totalDelta <= 0) return 0;
  return clamp((100 * (totalDelta - idleDelta)) / totalDelta);
}

const memInfoKeys = ["MemTotal", "MemAvailable"] as const;
type MemInfo = Partial<Record<(typeof memInfoKeys)[number], bigint>>;

async function readMemUsage(): Promise<Usage> {
  const stats = await parseMeminfo(readLines("/proc/meminfo"));
  const total = (stats.MemTotal ?? 0n) * 1024n;
  if (!total) return { usage: 0n, percent: 0 };

  const available = (stats.MemAvailable ?? 0n) * 1024n;
  const usage = total > available ? total - available : 0n;
  const percent = Number((10000n * usage) / total) / 100;

  return {
    usage,
    percent: clamp(percent),
  };
}

type DiskUsages<Root extends string> = Partial<Record<Root, Usage>>;
let diskUsageCache: DiskUsages<string> | null = null;
let diskUsageUpdatedAt: Date | null = null;

async function readDiskUsage<Roots extends string>(...roots: Roots[]) {
  if (diskUsageCache && diskUsageUpdatedAt && Date.now() - diskUsageUpdatedAt.getTime() < 600000) {
    return diskUsageCache as DiskUsages<Roots>;
  }
  const rootsSet = new Set(roots);
  const result: DiskUsages<Roots> = {};
  try {
    let isFirstLine = true;
    for await (const line of Bun.$`df -k --output=target,pcent,used`.lines()) {
      if (isFirstLine) {
        isFirstLine = false;
        continue;
      }

      const parts = line.trim().split(/\s+/, 3);
      if (parts.length < 3) continue;

      const target = parts[0] as Roots;
      if (!rootsSet.has(target)) continue;

      const percentText = parts[1];
      const usedText = parts[2];

      if (!percentText.endsWith("%")) continue;
      if (!/^\d+$/.test(usedText)) continue;

      const percent = Number(percentText.slice(0, -1));
      if (!Number.isFinite(percent)) continue;
      const usedKb = BigInt(usedText);

      result[target] = {
        usage: usedKb * 1024n,
        percent: clamp(percent),
      };

      if (Object.keys(result).length >= rootsSet.size) break;
    }

    diskUsageCache = result;
    diskUsageUpdatedAt = new Date();
  } catch (error) {
    console.error("Error reading disk usage:", error);
  }
  return result;
}

const hwmonPath = await getHwmonPaths("k10temp");
async function readCpuTemperature(): Promise<number> {
  if (!hwmonPath) return 0;

  const temp = await readNumberFile(hwmonPath);
  return Number(temp) / 1000;
}

async function getHwmonPaths(sensor: string): Promise<string> {
  for await (const line of Bun.$`ls -1 /sys/class/hwmon`.lines()) {
    const dir = line.trim();
    if (!dir) continue;

    const nameFileName = `/sys/class/hwmon/${dir}/name`;
    const name = await readText(nameFileName);
    if (name?.trim() === sensor) {
      return nameFileName.replace(/\/name$/, "/temp1_input");
    }
  }
  return "";
}

async function readNetUsage(iface: string): Promise<NetUsage> {
  const [lastRx, lastTx] = await Promise.all([
    readNumberFile(`/sys/class/net/${iface}/statistics/rx_bytes`),
    readNumberFile(`/sys/class/net/${iface}/statistics/tx_bytes`),
  ]);

  return { lastTx, lastRx };
}

async function parseCpuSample(stat: AsyncIterable<string>) {
  let cpuLine: string | undefined;
  for await (const line of stat) {
    if (line.startsWith("cpu ")) {
      cpuLine = line;
      break;
    }
  }
  if (!cpuLine) return undefined;

  const values = cpuLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number(value));

  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return undefined;

  const idle = values[3] + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

const memInfoRegex = new RegExp(`^(${memInfoKeys.join("|")}):\\s+(\\d+)`, "m");
async function parseMeminfo(meminfo: AsyncIterable<string>) {
  const stats: MemInfo = {};
  let count = 0;
  for await (const line of meminfo) {
    const match = line.match(memInfoRegex);
    if (!match) continue;
    stats[match[1] as keyof MemInfo] = BigInt(match[2]);
    count++;
    if (count >= memInfoKeys.length) break;
  }
  return stats;
}

async function readNumberFile(path: string): Promise<bigint> {
  const text = await readText(path);
  if (!text) return 0n;

  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return 0n;

  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

async function* readLines(path: string) {
  const stream = Bun.file(path).stream().pipeThrough(new TextDecoderStream());
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      yield line;
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  if (buffer.length > 0) {
    yield buffer;
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function serializeWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_, inner) => (typeof inner === "bigint" ? `${inner}n` : inner));
}
