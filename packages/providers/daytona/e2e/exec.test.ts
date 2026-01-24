import { afterEach, describe, expect, it } from "vitest";

import { DaytonaProvider } from "../src/index.js";

describe("daytona e2e exec", () => {
  const name = "usbx-daytona";
  const provider = new DaytonaProvider({ createParams: { language: "typescript" } });

  afterEach(async () => {
    try {
      await provider.delete(name);
    } catch {
      // Best-effort cleanup.
    }
  });

  it("creates a sandbox and runs a command", async () => {
    try {
      await provider.delete(name);
    } catch {
      // Best-effort cleanup before create.
    }

    const sandbox = await provider.create({ name });
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
