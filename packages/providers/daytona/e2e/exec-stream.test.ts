import { afterEach, describe, expect, it } from "vitest";

import { DaytonaProvider } from "../src/index.js";

const readStreamText = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      output += decoder.decode(value, { stream: true });
    }
  }

  output += decoder.decode();
  return output;
};

describe("daytona e2e execStream", () => {
  const name = "usbx-daytona-stream";
  const provider = new DaytonaProvider({ createParams: { language: "typescript" } });

  afterEach(async () => {
    try {
      await provider.delete(name);
    } catch {
      // Best-effort cleanup.
    }
  });

  it("streams a command", async () => {
    try {
      await provider.delete(name);
    } catch {
      // Best-effort cleanup before create.
    }

    const sandbox = await provider.create({ name });
    try {
      const result = await sandbox.execStream("echo", ["hello"]);
      const stdout = await readStreamText(result.stdout);

      await expect(result.exitCode).resolves.toBe(0);
      expect(stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
