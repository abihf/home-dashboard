import { afterEach, describe, expect, it, vi } from "vitest";

async function loadModule() {
  return await import("./file");
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it("continue reading after a chunk with no newline", async () => {
    const { readLines } = await loadModule();
    stubBunFile({
      "/tmp/lines": createMockBunFile({ chunks: ["a", "z", "b\nc", "d\n"] }),
    });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).resolves.toEqual(["azb", "cd"]);
  });

  it("throws when a continued line exceeds the maximum length", async () => {
    const { readLines } = await loadModule();
    stubBunFile({
      "/tmp/lines": createMockBunFile({ chunks: ["a".repeat(1024 * 1024), "b"] }),
    });

    await expect(Array.fromAsync(readLines("/tmp/lines"))).rejects.toThrow(
      "Line exceeds maximum length of 1048576 bytes",
    );
  });
});
