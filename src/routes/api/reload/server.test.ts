import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadModule() {
  return await import("./+server");
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

beforeEach(() => {
  vi.resetModules();
});

describe("GET /api/reload", () => {
  it("responds with a server-sent event stream", async () => {
    const { GET } = await loadModule();
    const response = await GET({} as never);

    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const stream = sseReader(response);
    expect(await stream.next()).toBe("event: data\n");
    await stream.cancel();
  });
});

describe("POST /api/reload", () => {
  it("reports zero when nobody is subscribed", async () => {
    const { POST } = await loadModule();
    const response = await POST({} as never);
    await expect(response.json()).resolves.toEqual({ ok: 0 });
  });

  it("notifies all subscribers and reports their count", async () => {
    const { GET, POST } = await loadModule();
    const first = sseReader(await GET({} as never));
    const second = sseReader(await GET({} as never));
    await first.next();
    await second.next();

    const response = await POST({} as never);
    await expect(response.json()).resolves.toEqual({ ok: 2 });

    const timestamp = expect.stringMatching(/^data: \d+\n\n$/);
    expect(await first.next()).toEqual(timestamp);
    expect(await second.next()).toEqual(timestamp);

    await first.cancel();
    await second.cancel();
  });

  it("stops notifying streams that were canceled", async () => {
    const { GET, POST } = await loadModule();
    const stream = sseReader(await GET({} as never));
    await stream.next();

    await stream.cancel();

    const response = await POST({} as never);
    await expect(response.json()).resolves.toEqual({ ok: 0 });
  });
});
