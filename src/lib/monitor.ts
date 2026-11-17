import { statfs } from "node:fs/promises";
import { readLines, readNumberFile, readText } from "./file.js";

export interface Usage {
  usage: number;
  percent: number;
}

export interface NetUsage {
  lastTx: number;
  lastRx: number;
}

export interface StatusResponse {
  cpuUsage: number;
  cpuTemp: number;
  memUsage: Usage;
  diskRoot: Usage;
  diskMedia: Usage;
  netUsage: NetUsage;
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

export interface MonitorConfig {
  netIface: string;
  cpuSensor: string;
  diskRoot: string;
  diskMedia: string;
  intervalMs: number;
}

export function loadMonitorConfig(env: Record<string, string | undefined> = process.env) {
  const interval = Number(env.MONITOR_INTERVAL_MS);
  return {
    netIface: env.MONITOR_NET_IFACE || "eth1",
    cpuSensor: env.MONITOR_CPU_SENSOR || "k10temp",
    diskRoot: env.MONITOR_DISK_ROOT || "/",
    diskMedia: env.MONITOR_DISK_MEDIA || "/media/data",
    intervalMs: Number.isFinite(interval) && interval >= 100 ? interval : 1000,
  } satisfies MonitorConfig;
}

export async function query(
  reader: MetricsReader,
  config: Pick<MonitorConfig, "netIface" | "diskRoot" | "diskMedia"> = loadMonitorConfig(),
): Promise<StatusResponse> {
  const [cpuUsage, memUsage, disk, cpuTemp, netUsage] = await Promise.all([
    reader.readCpuUsage(),
    reader.readMemUsage(),
    reader.readDiskUsage(config.diskRoot, config.diskMedia),
    reader.readCpuTemperature(),
    reader.readNetUsage(config.netIface),
  ]);

  const status: StatusResponse = {
    cpuUsage,
    cpuTemp,
    memUsage,
    diskRoot: disk[config.diskRoot] ?? zeroUsage,
    diskMedia: disk[config.diskMedia] ?? zeroUsage,
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
      const results = await Promise.allSettled(roots.map((root) => statfs(root)));
      const usage: DiskUsages<Roots> = {};
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(`Error reading disk usage for ${roots[i]}:`, result.reason);
          return;
        }
        usage[roots[i]] = statfsToUsage(result.value);
      });
      return usage;
    },

    async readCpuTemperature() {
      if (!hwmonPathPromise) {
        hwmonPathPromise = findHwmonTempInput(loadMonitorConfig().cpuSensor);
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

const memInfoRegex = new RegExp(`^(${memInfoKeys.join("|")}):\\s+(\\d+)`);

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

export function statfsToUsage(fs: { bsize: number; blocks: number; bfree: number }): Usage {
  const used = fs.blocks - fs.bfree;
  return {
    usage: used * fs.bsize,
    percent: fs.blocks > 0 ? clamp((100 * used) / fs.blocks) : 0,
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
