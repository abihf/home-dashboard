import { describe, expect, it } from "vitest";
import { css } from "./css";

describe("css", () => {
  it("returns an empty string for no properties", () => {
    expect(css({})).toBe("");
  });

  it("converts camelCase properties to kebab-case", () => {
    expect(css({ marginTop: "10px" })).toBe("margin-top:10px");
    expect(css({ backgroundColor: "red" })).toBe("background-color:red");
  });

  it("joins multiple declarations with semicolons", () => {
    expect(css({ color: "red", backgroundColor: "blue" })).toBe("color:red;background-color:blue");
  });

  it("supports numeric values", () => {
    expect(css({ zIndex: 5, opacity: 0.5 } as never)).toBe("z-index:5;opacity:0.5");
  });

  it("omits undefined values", () => {
    expect(css({ opacity: undefined, color: "red" } as never)).toBe("color:red");
  });

  it("keeps consecutive uppercase letters together when kebabifying", () => {
    expect(css({ backgroundURL: "img.png" } as never)).toBe("background-url:img.png");
  });
});
