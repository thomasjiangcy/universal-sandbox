import { describe, expect, it } from "vitest";

import { DockerProvider } from "../src/index.js";

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

describe("docker e2e create-exec", () => {
  it("creates a container and runs a command", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = process.env.DOCKER_IMAGE ?? "alpine";
    const provider = new DockerProvider({ defaultImage: image });

    const sandbox = await provider.create({ name });
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 20000);

  it("streams a command", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = process.env.DOCKER_IMAGE ?? "alpine";
    const provider = new DockerProvider({ defaultImage: image });

    const sandbox = await provider.create({ name });
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
