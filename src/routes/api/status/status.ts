import { readLines, readNumberFile, readText } from "$lib/file";

import type { NetUsage, StatusResponse, Usage } from "./types";

export type SystemMonitor = ReturnType<typeof createSystemMonitor>;

export function createSystemMonitor(reader: MetricsReader) {
  type MonitorSubscriber = (res: string) => void;
  const subscribers = new Set<MonitorSubscriber>();
  let intervalHandler: ReturnType<typeof setInterval> | null = null;

  async function queryAndPublish() {
    let res: string;
    try {
      const status = await query(reader);
      res = `data: ${JSON.stringify(status)}\n\n`;
    } catch (error: any) {
      res = `event: error\ndata: ${error.message ?? String(error)}\n\n`;
    }
    for (const subscriber of subscribers) {
      subscriber(res);
    }
  }

  function start() {
    if (intervalHandler) return;
    void queryAndPublish();

    intervalHandler = setInterval(() => {
      void queryAndPublish();
    }, 1000);
  }

  function stop() {
    if (subscribers.size > 0) return;
    if (intervalHandler) {
      clearInterval(intervalHandler);
      intervalHandler = null;
    }
  }

  function stream() {
    let callback: MonitorSubscriber | undefined = undefined;
    let canceled = false;
    const stream = new ReadableStream<string>({
      start(controller) {
        callback = (res) => {
          if (!canceled) {
            controller.enqueue(res);
          }
        };
        subscribers.add(callback);
        start();
      },
      cancel() {
        canceled = true;
        if (callback) {
          subscribers.delete(callback);
        }
        stop();
      },
    });

    return stream;
  }

  return {
    stream,
  };
}

export type DiskUsages<Roots extends string> = Partial<Record<Roots, Usage>>;

export interface MetricsReader {
  readCpuUsage(): Promise<number>;
  readMemUsage(): Promise<Usage>;
  readDiskUsage<Roots extends string>(...roots: Roots[]): Promise<DiskUsages<Roots>>;
  readCpuTemperature(): Promise<number>;
  readNetUsage(iface: string): Promise<NetUsage>;
}

const zeroUsage: Usage = { usage: 0, percent: 0 };

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
    diskRoot: disk["/"] ?? zeroUsage,
    diskMedia: disk["/media/data"] ?? zeroUsage,
    netUsage,
  };
  return status;
}

interface CpuSample {
  idle: number;
  total: number;
}

export function createMetricsReader(): MetricsReader {
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

async function findHwmonTempInput(
  sensor: string,
  inputName = "temp1_input",
): Promise<string | null> {
  const hwmonDir = "/sys/class/hwmon";
  for await (const line of Bun.$`ls -1 ${hwmonDir}/`.lines()) {
    const dir = line.trim();
    if (!dir) continue;

    const nameFileName = `${hwmonDir}/${dir}/name`;
    const name = await readText(nameFileName);
    if (name?.trim() === sensor) {
      return `${hwmonDir}/${dir}/${inputName}`;
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
  return { idle, total } as CpuSample;
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

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
