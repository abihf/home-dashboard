import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Clock from "./Clock.svelte";

describe("Clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-03T14:05:06Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the current date and time", () => {
    const now = new Date();
    const expectedDate = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    const expectedTime = now.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const { body } = render(Clock);

    expect(body).toContain('title="Date time"');
    expect(body).toContain(expectedDate);
    expect(body).toContain(expectedTime);
  });
});
