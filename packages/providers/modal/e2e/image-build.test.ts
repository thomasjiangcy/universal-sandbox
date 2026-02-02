import { afterEach, describe, expect, it } from "vitest";

import { ModalProvider } from "../src/index.js";

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

describe("modal e2e image build", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("builds an image and starts a sandbox", async () => {
    const provider = new ModalProvider({
      appName: process.env.MODAL_APP_NAME ?? "usbx-sandbox",
      imageRef: "python:3.13-slim",
    });

    const image = await provider.images.build({
      baseImage: "python:3.13-slim",
      dockerfileCommands: ["RUN echo hello > /hello.txt"],
    });

    const sandbox = await provider.create({ image });
    cleanup.add(() => provider.delete(sandbox.id));

    const result = await sandbox.exec("cat", ["/hello.txt"]);
    expect(result.stdout).toContain("hello");
  }, 120000);
});
