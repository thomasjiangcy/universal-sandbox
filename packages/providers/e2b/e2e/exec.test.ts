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

describe("e2b e2e exec", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("creates a sandbox and runs a command", async () => {
    const provider = new E2BProvider();

    const sandbox = await provider.create();
    cleanup.add(() => provider.delete(sandbox.id));
    const result = await sandbox.exec("echo", ["hello"]);
    expect(result.stdout).toContain("hello");
  }, 20000);
});
