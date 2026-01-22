import { describe, expect, it } from "vitest";

import { E2BProvider } from "../src/index.js";

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

describe("e2b e2e create-exec", () => {
  it("creates a sandbox and runs a command", async () => {
    const provider = new E2BProvider();

    const sandbox = await provider.create();
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 20000);

  it("streams a command", async () => {
    const provider = new E2BProvider();

    const sandbox = await provider.create();
    try {
      const result = await sandbox.execStream("echo", ["hello"]);
      const stdout = await readStreamText(result.stdout);

      await expect(result.exitCode).resolves.toBe(0);
      expect(stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 20000);
});
