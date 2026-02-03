import { afterEach, describe, expect, it } from "vitest";

import { E2BProvider } from "../src/index.js";

type CleanupTask = () => Promise<void>;

const createCleanup = () => {
  let tasks: CleanupTask[] = [];

  return {
    add(task: CleanupTask) {
      tasks.push(task);
    },
    async run() {
      const current = tasks;
      tasks = [];
      for (const task of current) {
        try {
          await task();
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  };
};

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

describe("e2b e2e execStream", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("streams a command", async () => {
    const provider = new E2BProvider();

    const sandbox = await provider.create();
    cleanup.add(() => provider.delete(sandbox.id));
    const result = await sandbox.execStream("echo", ["hello"]);
    const stdout = await readStreamText(result.stdout);

    await expect(result.exitCode).resolves.toBe(0);
    expect(stdout).toContain("hello");
  }, 20000);
});
