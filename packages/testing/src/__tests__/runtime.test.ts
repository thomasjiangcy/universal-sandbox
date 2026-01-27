import { describe, expect, it } from "vitest";

import { SandboxManager } from "../../../core/src/index.js";
import { LocalProvider } from "../index.js";

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

describe("SandboxManager", () => {
  it("creates and gets sandboxes through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new SandboxManager({ provider });

    const created = await runtime.create({ name: "sbx-1" });
    const fetched = await runtime.get("sbx-1");

    expect(created.id).toBe("sbx-1");
    expect(fetched.id).toBe("sbx-1");
  });

  it("executes a command through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new SandboxManager({ provider });
    const sandbox = await runtime.create({ name: "sbx-2" });

    const result = await sandbox.exec("echo", ["hello"]);

    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
  });

  it("streams a command through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new SandboxManager({ provider });
    const sandbox = await runtime.create({ name: "sbx-2-stream" });

    const result = await sandbox.execStream("echo", ["hello"]);
    const stdout = await readStreamText(result.stdout);
    const stderr = await readStreamText(result.stderr);

    await expect(result.exitCode).resolves.toBe(0);
    expect(stdout).toContain("hello");
    expect(stderr).toBe("");
  });

  it("deletes a sandbox through the provider", async () => {
    const provider = new LocalProvider({ defaultName: "local-test" });
    const runtime = new SandboxManager({ provider });
    await runtime.create({ name: "sbx-3" });

    await runtime.delete("sbx-3");

    await expect(runtime.get("sbx-3")).rejects.toThrow("Sandbox not found");
  });
});
