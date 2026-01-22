import { describe, expect, it } from "vitest";

import { readTextOrEmpty } from "./internal.js";

describe("readTextOrEmpty", () => {
  it("returns empty string for undefined", async () => {
    await expect(readTextOrEmpty(undefined)).resolves.toBe("");
  });

  it("returns empty string for null", async () => {
    await expect(readTextOrEmpty(null)).resolves.toBe("");
  });

  it("reads from provided stream", async () => {
    const stream = {
      readText: async () => "ok",
    };

    await expect(readTextOrEmpty(stream)).resolves.toBe("ok");
  });
});