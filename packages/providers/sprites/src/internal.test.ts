import { describe, expect, it } from "vitest";

import { normalizeExitCode, normalizeOutput } from "./internal.js";

describe("normalizeOutput", () => {
  it("returns empty string when value is undefined", () => {
    expect(normalizeOutput(undefined)).toBe("");
  });

  it("returns string values as-is", () => {
    expect(normalizeOutput("hello")).toBe("hello");
  });

  it("converts buffers to utf8 strings", () => {
    expect(normalizeOutput(Buffer.from("buffered", "utf8"))).toBe("buffered");
  });
});

describe("normalizeExitCode", () => {
  it("returns null when undefined", () => {
    expect(normalizeExitCode(undefined)).toBeNull();
  });

  it("returns null when null", () => {
    expect(normalizeExitCode(null)).toBeNull();
  });

  it("preserves numeric exit codes", () => {
    expect(normalizeExitCode(0)).toBe(0);
    expect(normalizeExitCode(2)).toBe(2);
  });
});
