import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Status from "./Status.svelte";

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