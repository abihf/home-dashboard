import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { MetricsReader } from "./monitor";

async function loadModule() {
  return await import("./monitor");
}

async function* asyncLines(lines: Iterable<string>): AsyncIterable<string> {
  yield* lines;
}

export function createMockReader(overrides: Partial<MetricsReader> = {}): MetricsReader {
  return {
    readCpuUsage: vi.fn().mockResolvedValue(12),
    readMemUsage: vi.fn().mockResolvedValue({ usage: 1024, percent: 10 }),
    readDiskUsage: vi.fn().mockResolvedValue({
      "/": { usage: 2048, percent: 20 },
      "/media/data": { usage: 4096, percent: 30 },
    }),
    readCpuTemperature: vi.fn().mockResolvedValue(45),
    readNetUsage: vi.fn().mockResolvedValue({ lastTx: 1000, lastRx: 2000 }),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseCpuSample", () => {
  it("extracts idle and total from /proc/stat cpu line", async () => {
    const { parseCpuSample } = await loadModule();
    const sample = await parseCpuSample(asyncLines(["cpu  1 2 3 4 5 6 7 8 9 10"]));
    expect(sample).toEqual({ idle: 9, total: 55 });
  });

  it("returns undefined when cpu line is missing", async () => {
    const { parseCpuSample } = await loadModule();
    const sample = await parseCpuSample(asyncLines(["cpu0 1 2 3 4"]));
    expect(sample).toBeUndefined();
  });

  it("returns undefined when values are not numeric", async () => {
    const { parseCpuSample } = await loadModule();
    const sample = await parseCpuSample(asyncLines(["cpu  a b c d"]));
    expect(sample).toBeUndefined();
  });
});

describe("parseMeminfo", () => {
  it("extracts MemTotal and MemAvailable", async () => {
    const { parseMeminfo } = await loadModule();
    const stats = await parseMeminfo(
      asyncLines(["MemTotal:       1000000 kB", "MemAvailable:    500000 kB"]),
    );
    expect(stats).toEqual({ MemTotal: 1000000, MemAvailable: 500000 });
  });

  it("ignores unrelated lines", async () => {
    const { parseMeminfo } = await loadModule();
    const stats = await parseMeminfo(
      asyncLines([
        "MemFree:        100000 kB",
        "MemTotal:       1000000 kB",
        "Buffers:         100000 kB",
        "MemAvailable:    500000 kB",
      ]),
    );
    expect(stats).toEqual({ MemTotal: 1000000, MemAvailable: 500000 });
  });
});

describe("statfsToUsage", () => {
  it("computes used bytes and percent", async () => {
    const { statfsToUsage } = await loadModule();
    expect(statfsToUsage({ bsize: 4096, blocks: 100, bfree: 75 })).toEqual({
      usage: 25 * 4096,
      percent: 25,
    });
  });

  it("returns zero percent for zero blocks", async () => {
    const { statfsToUsage } = await loadModule();
    expect(statfsToUsage({ bsize: 4096, blocks: 0, bfree: 0 })).toEqual({ usage: 0, percent: 0 });
  });
});

describe("query", () => {
  it("combines all reader outputs into a StatusResponse", async () => {
    const { query } = await loadModule();
    const reader = createMockReader();
    const result = await query(reader);

    expect(result).toEqual({
      cpuUsage: 12,
      cpuTemp: 45,
      memUsage: { usage: 1024, percent: 10 },
      diskRoot: { usage: 2048, percent: 20 },
      diskMedia: { usage: 4096, percent: 30 },
      netUsage: { lastTx: 1000, lastRx: 2000 },
    });
  });

  it("defaults missing disk roots to zero usage", async () => {
    const { query } = await loadModule();
    const reader = createMockReader({
      readDiskUsage: vi.fn().mockResolvedValue({}),
    });
    const result = await query(reader);

    expect(result.diskRoot).toEqual({ usage: 0, percent: 0 });
    expect(result.diskMedia).toEqual({ usage: 0, percent: 0 });
  });
});
