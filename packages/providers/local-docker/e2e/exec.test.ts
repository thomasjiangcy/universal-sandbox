import { afterEach, describe, expect, it } from "vitest";

import { LocalDockerProvider } from "../src/index.js";

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

describe("local-docker e2e exec", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("creates a container and runs a command", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = process.env.DOCKER_IMAGE ?? "alpine";
    const provider = new LocalDockerProvider({ defaultImage: image });

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 20000);
});
