import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MetricsReader } from "./status";

async function loadModule() {
  return await import("./status");
}

function sseReader(response: Response) {
  if (!response.body) throw new Error("response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return {
    async next() {
      const { value } = await reader.read();
      return typeof value === "string" ? value : decoder.decode(value);
    },
    cancel: () => reader.cancel(),
  };
}

async function* asyncLines(lines: Array<string>): AsyncIterable<string> {
  for (const line of lines) {
    yield line;
  }
}

type MockBunFile = {
  text: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
};

function createMockBunFile(
  options: { text?: string; chunks?: Array<string>; throwText?: boolean } = {},
): MockBunFile {
  const encoder = new TextEncoder();
  const chunks = options.chunks ?? [options.text ?? ""];
  return {
    text: vi.fn().mockImplementation(() => {
      if (options.throwText) return Promise.reject(new Error("read failed"));
      return Promise.resolve(options.text ?? "");
    }),
    stream: vi.fn().mockReturnValue(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
    ),
  };
}

function stubBunFile(files: Record<string, MockBunFile>) {
  const bun = Bun as unknown as { file: (path: string) => Bun.BunFile };
  vi.spyOn(bun, "file").mockImplementation((path: string) => {
    return (files[path] ?? createMockBunFile({ throwText: true })) as unknown as Bun.BunFile;
  });
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
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

describe("readText", () => {
  it("returns file contents", async () => {
    const { readText } = await loadModule();
    stubBunFile({ "/tmp/foo": createMockBunFile({ text: "hello" }) });

    await expect(readText("/tmp/foo")).resolves.toBe("hello");
  });

  it("returns null when reading fails", async () => {
    const { readText } = await loadModule();
    stubBunFile({ "/tmp/foo": createMockBunFile({ throwText: true }) });

    await expect(readText("/tmp/foo")).resolves.toBeNull();
  });
});

describe("readNumberFile", () => {
  it("returns the numeric value", async () => {
    const { readNumberFile } = await loadModule();
    stubBunFile({ "/tmp/count": createMockBunFile({ text: "12345" }) });

    await expect(readNumberFile("/tmp/count")).resolves.toBe(12345);
  });

  it("trims whitespace", async () => {
    const { readNumberFile } = await loadModule();
    stubBunFile({ "/tmp/count": createMockBunFile({ text: "  42  \n" }) });

    await expect(readNumberFile("/tmp/count")).resolves.toBe(42);
  });

  it("returns 0 when the file is empty", async () => {
    const { readNumberFile } = await loadModule();
    stubBunFile({ "/tmp/count": createMockBunFile({ text: "" }) });

    await expect(readNumberFile("/tmp/count")).resolves.toBe(0);
  });

  it("returns 0 for non-numeric content", async () => {
    const { readNumberFile } = await loadModule();
    stubBunFile({ "/tmp/count": createMockBunFile({ text: "not-a-number" }) });

    await expect(readNumberFile("/tmp/count")).resolves.toBe(0);
  });

  it("returns 0 when reading fails", async () => {
    const { readNumberFile } = await loadModule();
    stubBunFile({ "/tmp/count": createMockBunFile({ throwText: true }) });

    await expect(readNumberFile("/tmp/count")).resolves.toBe(0);
  });
});

describe("readLines", () => {
  it("yields lines split by newlines", async () => {
    const { readLines } = await loadModule();
    stubBunFile({ "/tmp/lines": createMockBunFile({ text: "a\nb\nc" }) });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).resolves.toEqual(["a", "b", "c"]);
  });

  it("yields the remaining content when there is no trailing newline", async () => {
    const { readLines } = await loadModule();
    stubBunFile({ "/tmp/lines": createMockBunFile({ text: "a\nb" }) });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).resolves.toEqual(["a", "b"]);
  });

  it("handles chunks split mid-line", async () => {
    const { readLines } = await loadModule();
    stubBunFile({
      "/tmp/lines": createMockBunFile({ chunks: ["a\nb", "c\nd", "\n"] }),
    });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).resolves.toEqual(["a", "bc", "d"]);
  });

  it("yields nothing for an empty stream", async () => {
    const { readLines } = await loadModule();
    stubBunFile({ "/tmp/lines": createMockBunFile({ text: "" }) });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).resolves.toEqual([]);
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

describe("createStatusStream", () => {
  it("returns a server-sent event stream", async () => {
    const { createStatusStream } = await loadModule();
    const response = createStatusStream(createMockReader());

    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("emits a data event from the reader", async () => {
    const { createStatusStream } = await loadModule();
    const response = createStatusStream(createMockReader());

    const stream = sseReader(response);
    const line = await stream.next();
    expect(line).toMatch(/^data: \{.*\}\n\n$/);

    await stream.cancel();
  });

  it("emits an error event when the reader fails", async () => {
    const { createStatusStream } = await loadModule();
    const reader = createMockReader({
      readCpuUsage: vi.fn().mockRejectedValue(new Error("cpu failed")),
    });
    const response = createStatusStream(reader);

    const stream = sseReader(response);
    const line = await stream.next();
    expect(line).toBe("event: error\ndata: metrics read failed\n\n");

    await stream.cancel();
  });
});
