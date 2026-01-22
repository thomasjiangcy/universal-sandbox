import { describe, expect, it } from "vitest";

import { ModalProvider } from "../src/index.js";

describe("modal e2e create-exec", () => {
  it("creates a sandbox and runs a command", async () => {
    const provider = new ModalProvider({
      appName: "usbx-e2e",
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await sandbox.native.terminate();
    }
  }, 30000);
});
