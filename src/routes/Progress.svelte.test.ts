import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Progress from "./Progress.svelte";

describe("Progress", () => {
  it("renders the current value in aria-valuenow", () => {
    const { body } = render(Progress, { props: { percent: 42 } });

    expect(body).toContain('role="progressbar"');
    expect(body).toContain('aria-valuenow="42"');
  });

  it("caps values above 100", () => {
    const { body } = render(Progress, { props: { percent: 150 } });

    expect(body).toContain('aria-valuenow="100"');
    expect(body).toContain("transform:scaleX(1)");
    expect(body).toContain("transform:scaleX(0)");
  });

  it("keeps values below zero unchanged", () => {
    const { body } = render(Progress, { props: { percent: -10 } });

    expect(body).toContain('aria-valuenow="-10"');
    expect(body).toContain("transform:scaleX(-0.1)");
    expect(body).toContain("transform:scaleX(1.1)");
  });

  it("appends className to the root element", () => {
    const { body } = render(Progress, { props: { percent: 30, className: "ring-2" } });

    expect(body).toContain("ring-2");
  });
});