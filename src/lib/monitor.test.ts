import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("parseDiskUsage", () => {
  it("extracts usage and percent for requested roots", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/         50%   1024", "/media/data 75% 2048"]),
      ["/", "/media/data"],
    );
    expect(usage).toEqual({
      "/": { usage: 1024 * 1024, percent: 50 },
      "/media/data": { usage: 2048 * 1024, percent: 75 },
    });
  });

  it("skips the header line", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/         10%   512"]),
      ["/"],
    );
    expect(usage).toEqual({
      "/": { usage: 512 * 1024, percent: 10 },
    });
  });

  it("ignores unrequested mount points", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines([
        "Mounted on Use%  Used",
        "/boot      20%   256",
        "/          10%   512",
        "/other     99%   999",
      ]),
      ["/"],
    );
    expect(usage).toEqual({
      "/": { usage: 512 * 1024, percent: 10 },
    });
  });

  it("ignores invalid or non-numeric percentage values", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/         abc   512", "/media/data 50% 1024"]),
      ["/", "/media/data"],
    );
    expect(usage).toEqual({
      "/media/data": { usage: 1024 * 1024, percent: 50 },
    });
  });

  it("ignores non-numeric used values", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/         50%   xyz"]),
      ["/"],
    );
    expect(usage).toEqual({});
  });

  it("stops parsing once all roots are matched", async () => {
    const { parseDiskUsage } = await loadModule();
    let yieldedAfterMatch = false;

    async function* endlessStream() {
      yield "Mounted on Use%  Used";
      yield "/         10%   512";
      yieldedAfterMatch = true;
      yield "/media/data 20% 1024";
    }

    const usage = await parseDiskUsage(endlessStream(), ["/"]);
    expect(usage).toEqual({ "/": { usage: 512 * 1024, percent: 10 } });
    expect(yieldedAfterMatch).toBe(false);
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
