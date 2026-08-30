import { render } from "svelte/server";
import { describe, expect, it, vi } from "vite-plus/test";
import Status from "./Status.svelte";

const zero = { percent: 0, usage: 0 };

vi.mock("./status.remote", () => ({
  getStatus: () => ({
    current: {
      cpuUsage: 0,
      cpuTemp: 0,
      memUsage: zero,
      diskRoot: zero,
      diskMedia: zero,
      upload: zero,
      download: zero,
    },
  }),
}));

describe("Status", () => {
  it("renders all progress sections", () => {
    const { body } = render(Status);
    const matches = body.match(/role="progressbar"/g) ?? [];

    expect(matches).toHaveLength(7);
  });

  it("renders zeroed values by default", () => {
    const { body } = render(Status);

    expect(body).toContain("0.00%");
    expect(body).toContain("0.00 B");
    expect(body).toContain("0 B/s");
  });
});
