import { afterEach, describe, expect, it } from "vitest";

import { DaytonaProvider } from "../src/index.js";

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

describe("daytona e2e image build", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("builds a snapshot and creates a sandbox", async () => {
    const provider = new DaytonaProvider();
    const snapshotName = `usbx-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const image = await provider.images.build({
      name: snapshotName,
      baseImage: "python:3.12-slim",
    });
    cleanup.add(async () => {
      try {
        const snapshot = await provider.native.snapshot.get(snapshotName);
        await provider.native.snapshot.delete(snapshot);
      } catch {
        // Best-effort cleanup.
      }
    });

    const sandboxName = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sandbox = await provider.create({ name: sandboxName, image });
    cleanup.add(() => provider.delete(sandbox.id));

    const result = await sandbox.exec("echo", ["hello"]);
    expect(result.stdout).toContain("hello");
  }, 180000);
});
