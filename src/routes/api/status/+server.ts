import type { NetUsage, StatusResponse, Usage } from "./types";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async () => {
  return createStatusStream(createMetricsReader());
};

export type DiskUsages<Roots extends string> = Partial<Record<Roots, Usage>>;

export interface MetricsReader {
  readCpuUsage(): Promise<number>;
  readMemUsage(): Promise<Usage>;
  readDiskUsage<Roots extends string>(...roots: Roots[]): Promise<DiskUsages<Roots>>;
  readCpuTemperature(): Promise<number>;
  readNetUsage(iface: string): Promise<NetUsage>;
}

export async function query(reader: MetricsReader): Promise<StatusResponse> {
  const [cpuUsage, memUsage, disk, cpuTemp, netUsage] = await Promise.all([
    reader.readCpuUsage(),
    reader.readMemUsage(),
    reader.readDiskUsage("/", "/media/data"),
    reader.readCpuTemperature(),
    reader.readNetUsage("eth1"),
  ]);

  const status: StatusResponse = {
    cpuUsage,
    cpuTemp,
    memUsage,
    diskRoot: disk["/"] ?? { usage: 0, percent: 0 },
    diskMedia: disk["/media/data"] ?? { usage: 0, percent: 0 },
    netUsage,
  };
  return status;
}

export function createStatusStream(reader: MetricsReader): Response {
  let handler: ReturnType<typeof setInterval>;
  let canceled = false;

  const stream = new ReadableStream({
    start(controller) {
      async function queryAndUpdate() {
        try {
          const data = await query(reader);
          const json = JSON.stringify(data);
          if (!canceled) controller.enqueue(`data: ${json}\n\n`);
        } catch (error) {
          console.error("Error querying metrics:", error);
          if (!canceled) controller.enqueue("event: error\ndata: metrics read failed\n\n");
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
}

interface CpuSample {
  idle: number;
  total: number;
}

function createMetricsReader(): MetricsReader {
  let previousCpuSample: CpuSample | undefined;
  let diskUsageCache: DiskUsages<string> | null = {};
  let diskUsageUpdatedAt: Date | null = null;
  let hwmonPathPromise: Promise<string | null> | null = null;

  return {
    async readCpuUsage() {
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
    },

    async readMemUsage() {
      const stats = await parseMeminfo(readLines("/proc/meminfo"));
      const total = (stats.MemTotal ?? 0) * 1024;
      if (!total) return { usage: 0, percent: 0 };

      const available = (stats.MemAvailable ?? 0) * 1024;
      const usage = total > available ? total - available : 0;
      const percent = Number((10000 * usage) / total) / 100;

      return {
        usage,
        percent: clamp(percent),
      };
    },

    async readDiskUsage<Roots extends string>(...roots: Roots[]) {
      if (
        diskUsageCache &&
        diskUsageUpdatedAt &&
        Date.now() - diskUsageUpdatedAt.getTime() < 600000
      ) {
        return diskUsageCache as DiskUsages<Roots>;
      }
      try {
        const result = await parseDiskUsage(Bun.$`df -k --output=target,pcent,used`.lines(), roots);

        diskUsageCache = result;
        diskUsageUpdatedAt = new Date();
        return result;
      } catch (error) {
        console.error("Error reading disk usage:", error);
      }
      return diskUsageCache as DiskUsages<Roots>;
    },

    async readCpuTemperature() {
      if (!hwmonPathPromise) {
        hwmonPathPromise = findHwmonTempInput("k10temp");
      }
      const hwmonPath = await hwmonPathPromise;
      if (!hwmonPath) return 0;

      const temp = await readNumberFile(hwmonPath);
      return Number(temp) / 1000;
    },

    async readNetUsage(iface: string): Promise<NetUsage> {
      const [lastRx, lastTx] = await Promise.all([
        readNumberFile(`/sys/class/net/${iface}/statistics/rx_bytes`),
        readNumberFile(`/sys/class/net/${iface}/statistics/tx_bytes`),
      ]);

      return { lastTx, lastRx };
    },
  };
}

async function findHwmonTempInput(sensor: string): Promise<string | null> {
  for await (const line of Bun.$`ls -1 /sys/class/hwmon`.lines()) {
    const dir = line.trim();
    if (!dir) continue;

    const nameFileName = `/sys/class/hwmon/${dir}/name`;
    const name = await readText(nameFileName);
    if (name?.trim() === sensor) {
      return nameFileName.replace(/\/name$/, "/temp1_input");
    }
  }
  return null;
}

export async function parseCpuSample(stat: AsyncIterable<string>) {
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

const memInfoKeys = ["MemTotal", "MemAvailable"] as const;
type MemInfo = Partial<Record<(typeof memInfoKeys)[number], number>>;

const memInfoRegex = new RegExp(`^(${memInfoKeys.join("|")}):\\s+(\\d+)`, "m");

export async function parseMeminfo(meminfo: AsyncIterable<string>) {
  const stats: MemInfo = {};
  let count = 0;
  for await (const line of meminfo) {
    const match = line.match(memInfoRegex);
    if (!match) continue;
    stats[match[1] as keyof MemInfo] = Number(match[2]);
    count++;
    if (count >= memInfoKeys.length) break;
  }
  return stats;
}

export async function parseDiskUsage<Roots extends string>(
  dfOutput: AsyncIterable<string>,
  roots: Roots[],
) {
  const usage: DiskUsages<Roots> = {};
  const rootsSet = new Set(roots);
  let isFirstLine = true;
  for await (const line of dfOutput) {
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
    const usedKb = Number(usedText);

    usage[target] = {
      usage: usedKb * 1024,
      percent: clamp(percent),
    };

    if (Object.keys(usage).length >= rootsSet.size) break;
  }
  return usage;
}

export async function readNumberFile(path: string): Promise<number> {
  const text = await readText(path);
  if (!text) return 0;

  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return 0;

  try {
    return Number(trimmed);
  } catch {
    return 0;
  }
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text();
  } catch {
    return null;
  }
}

export async function* readLines(path: string) {
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
