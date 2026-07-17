import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStatus, initialStatus, normalizeSize } from "./status";

import type { StatusResponse } from "./api/status/types";

type Listener = (event: { data?: unknown }) => void;

class MockEventSource {
  static instances: Array<MockEventSource> = [];

  readonly listeners = new Map<string, Array<Listener>>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }
}

const baseStatus: StatusResponse = {
  cpuUsage: 12,
  cpuTemp: 45,
  memUsage: { usage: 1024, percent: 10 },
  diskRoot: { usage: 2048, percent: 20 },
  diskMedia: { usage: 4096, percent: 30 },
  netUsage: { lastTx: 1000, lastRx: 2000 },
};

const { netUsage: _netUsage, ...baseData } = baseStatus;
const zero = { percent: 0, usage: 0 };

describe("initialStatus", () => {
  it("is all zeros", () => {
    expect(initialStatus).toEqual({
      cpuUsage: 0,
      cpuTemp: 0,
      memUsage: zero,
      diskRoot: zero,
      diskMedia: zero,
      upload: zero,
      download: zero,
    });
  });
});

describe("normalizeSize", () => {
  it("keeps small sizes as-is", () => {
    expect(normalizeSize(500)).toBe("500.00 ");
    expect(normalizeSize(1024)).toBe("1024.00 ");
  });

  it("normalizes to the largest fitting suffix", () => {
    expect(normalizeSize(1025)).toBe("1.00 K");
    expect(normalizeSize(2048)).toBe("2.00 K");
    expect(normalizeSize(5 * 1024 ** 2)).toBe("5.00 M");
    expect(normalizeSize(3 * 1024 ** 3)).toBe("3.00 G");
  });

  it("only switches suffix above an exact power of 1024", () => {
    expect(normalizeSize(1024 ** 4)).toBe("1024.00 G");
    expect(normalizeSize(1024 ** 4 + 1)).toBe("1.00 T");
  });

  it("respects the digits parameter", () => {
    expect(normalizeSize(1536, 1)).toBe("1.5 K");
    expect(normalizeSize(2048, 0)).toBe("2 K");
  });
});

describe("fetchStatus", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes to the status endpoint", () => {
    fetchStatus(vi.fn());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/status");
  });

  it("reports zero network speed on the first message", () => {
    const set = vi.fn();
    fetchStatus(set);
    const source = MockEventSource.instances[0];

    source.emit("message", JSON.stringify(baseStatus));

    expect(set).toHaveBeenCalledWith({ ...baseData, upload: zero, download: zero });
  });

  it("computes network speed from the counter delta", () => {
    const set = vi.fn();
    fetchStatus(set);
    const source = MockEventSource.instances[0];

    source.emit("message", JSON.stringify(baseStatus));
    vi.setSystemTime(1_001_000);
    source.emit(
      "message",
      JSON.stringify({ ...baseStatus, netUsage: { lastTx: 6000, lastRx: 12000 } }),
    );

    expect(set).toHaveBeenLastCalledWith({
      ...baseData,
      upload: { usage: 5000, percent: 0.05 },
      download: { usage: 10000, percent: 0.1 },
    });
  });

  it("reports zero speed when the counters reset", () => {
    const set = vi.fn();
    fetchStatus(set);
    const source = MockEventSource.instances[0];

    source.emit("message", JSON.stringify(baseStatus));
    vi.setSystemTime(1_001_000);
    source.emit(
      "message",
      JSON.stringify({ ...baseStatus, netUsage: { lastTx: 100, lastRx: 200 } }),
    );

    expect(set).toHaveBeenLastCalledWith({ ...baseData, upload: zero, download: zero });
  });

  it("reports zero speed when no time has passed", () => {
    const set = vi.fn();
    fetchStatus(set);
    const source = MockEventSource.instances[0];

    source.emit("message", JSON.stringify(baseStatus));
    source.emit(
      "message",
      JSON.stringify({ ...baseStatus, netUsage: { lastTx: 6000, lastRx: 12000 } }),
    );

    expect(set).toHaveBeenLastCalledWith({ ...baseData, upload: zero, download: zero });
  });

  it("closes the event source when unsubscribed", () => {
    const unsubscribe = fetchStatus(vi.fn());
    const source = MockEventSource.instances[0];

    unsubscribe();

    expect(source.closed).toBe(true);
  });
});
