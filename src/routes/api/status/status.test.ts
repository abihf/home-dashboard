import { afterEach, describe, expect, it, vi } from "vitest";

import type { MetricsReader } from "./status";

async function loadModule() {
  return await import("./status");
}

async function* asyncLines(lines: Iterable<string>): AsyncIterable<string> {
  yield* lines;
}

function createMockReader(overrides: Partial<MetricsReader> = {}): MetricsReader {
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

async function readStreamChunk(reader: ReadableStreamDefaultReader<Uint8Array | string>) {
  const { value } = await reader.read();
  if (!value) return "";
  if (typeof value === "string") return value;
  return new TextDecoder().decode(value);
}

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
    expect(usage).toEqual({ "/": { usage: 512 * 1024, percent: 10 } });
  });

  it("ignores roots that are not present", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/         10%   512"]),
      ["/", "/media/data"],
    );
    expect(usage).toEqual({ "/": { usage: 512 * 1024, percent: 10 } });
  });

  it("skips lines with invalid format", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines([
        "Mounted on Use%  Used",
        "/         10%   512",
        "/media/data bad   2048",
        "/media/invalid 50%   xyz",
        "/boot     25%   256",
      ]),
      ["/", "/boot"],
    );
    expect(usage).toEqual({
      "/": { usage: 512 * 1024, percent: 10 },
      "/boot": { usage: 256 * 1024, percent: 25 },
    });
  });

  it("stops early once all roots are found", async () => {
    const { parseDiskUsage } = await loadModule();
    const lines = asyncLines([
      "Mounted on Use%  Used",
      "/         10%   512",
      "/media/data 20% 1024",
      "/extra    99%   9999",
    ]);
    const usage = await parseDiskUsage(lines, ["/", "/media/data"]);
    expect(usage).toEqual({
      "/": { usage: 512 * 1024, percent: 10 },
      "/media/data": { usage: 1024 * 1024, percent: 20 },
    });
  });

  it("returns an empty object when nothing matches", async () => {
    const { parseDiskUsage } = await loadModule();
    const usage = await parseDiskUsage(
      asyncLines(["Mounted on Use%  Used", "/other    10%   512"]),
      ["/"],
    );
    expect(usage).toEqual({});
  });
});

describe("query", () => {
  it("returns a status response from the reader", async () => {
    const { query } = await loadModule();
    const reader = createMockReader();

    await expect(query(reader)).resolves.toEqual({
      cpuUsage: 12,
      cpuTemp: 45,
      memUsage: { usage: 1024, percent: 10 },
      diskRoot: { usage: 2048, percent: 20 },
      diskMedia: { usage: 4096, percent: 30 },
      netUsage: { lastTx: 1000, lastRx: 2000 },
    });
  });

  it("uses zero defaults when disk usages are missing", async () => {
    const { query } = await loadModule();
    const reader = createMockReader({
      readDiskUsage: vi.fn().mockResolvedValue({}),
    });

    await expect(query(reader)).resolves.toEqual(
      expect.objectContaining({
        diskRoot: { usage: 0, percent: 0 },
        diskMedia: { usage: 0, percent: 0 },
      }),
    );
  });
});

describe("createSystemMonitor", () => {
  it("streams status to current and later subscribers", async () => {
    vi.useFakeTimers();
    const { createSystemMonitor } = await loadModule();
    const reader = createMockReader();
    const monitor = createSystemMonitor(reader);

    const firstStream = monitor.stream();
    const firstReader = firstStream.getReader();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    const firstChunk = await readStreamChunk(firstReader);
    expect(firstChunk).toContain("data: ");
    expect(firstChunk).toContain('"cpuUsage":12');

    const secondStream = monitor.stream();
    const secondReader = secondStream.getReader();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    const secondChunk = await readStreamChunk(secondReader);
    expect(secondChunk).toContain("data: ");
    expect(secondChunk).toContain('"cpuUsage":12');

    await firstReader.cancel();
    await secondReader.cancel();
  });
});
