import { describe, expect, it } from "vitest";

import { E2BProvider } from "../src/index.js";

describe("e2b e2e create-exec", () => {
  it("creates a sandbox and runs a command", async () => {
    const provider = new E2BProvider();

    const sandbox = await provider.create();
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await sandbox.native.kill();
    }
  }, 20000);
});
