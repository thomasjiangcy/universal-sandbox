import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

const createTempContext = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "usbx-docker-"));
  const dockerfilePath = path.join(dir, "Dockerfile");
  await fs.writeFile(dockerfilePath, ["FROM alpine", "RUN echo hello > /hello.txt"].join("\n"));
  return { dir, dockerfilePath };
};

describe("local-docker e2e image build", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("builds an image and runs a container", async () => {
    const provider = new LocalDockerProvider();
    const { dir } = await createTempContext();
    cleanup.add(() => fs.rm(dir, { recursive: true, force: true }));

    const imageName = `usbx-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = await provider.images.build({
      contextPath: dir,
      dockerfilePath: "Dockerfile",
      name: imageName,
    });

    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sandbox = await provider.create({ name, image });
    cleanup.add(() => provider.delete(sandbox.id));
    cleanup.add(async () => {
      try {
        await provider.native.getImage(imageName).remove({ force: true });
      } catch {
        // Best-effort cleanup.
      }
    });

    const result = await sandbox.exec("cat", ["/hello.txt"]);
    expect(result.stdout).toContain("hello");
  }, 60000);
});
