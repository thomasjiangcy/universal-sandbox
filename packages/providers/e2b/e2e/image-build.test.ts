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

describe("e2b e2e image build", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("builds a template and creates a sandbox", async () => {
    const provider = new E2BProvider();
    const alias = `usbx-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const image = await provider.images.build({
      name: alias,
      baseImage: "python:3.12-slim",
    });

    const sandbox = await provider.create({ image });
    cleanup.add(() => sandbox.kill());
    const result = await sandbox.exec("echo", ["hello"]);
    expect(result.stdout).toContain("hello");
  }, 180000);
});
