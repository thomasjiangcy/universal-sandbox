import { describe, expect, it } from "vitest";

import { DaytonaProvider } from "../src/index.js";

describe("daytona e2e create-exec", () => {
  it("creates a sandbox and runs a command", async () => {
    const provider = new DaytonaProvider({ createParams: { language: "typescript" } });

    const sandbox = await provider.create({ name: "usbx-daytona" });
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await provider.native.delete(sandbox.native, 60);
    }
  }, 30000);
});
