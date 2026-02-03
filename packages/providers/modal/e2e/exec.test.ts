import { afterEach, describe, expect, it } from "vitest";

import { ModalClient } from "modal";

import { ModalProvider } from "../src/index.js";

type CleanupTask = () => Promise<void>;

const getModalClient = (): ModalClient => {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error("Modal credentials missing: set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.");
  }
  return new ModalClient({ tokenId, tokenSecret });
};

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

describe("modal e2e exec", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("creates a sandbox and runs a command", async () => {
    const client = getModalClient();
    const appName = process.env.MODAL_APP_NAME ?? "usbx-e2e";
    const app = await client.apps.fromName(appName, { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    const cleanupTask = async () => {
      await provider.delete(sandbox.id);
      client.close();
    };
    cleanup.add(cleanupTask);
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await cleanupTask();
    }
  }, 30000);

  it("handles inherit stdout and stderr", async () => {
    const client = getModalClient();
    const appName = process.env.MODAL_APP_NAME ?? "usbx-e2e";
    const app = await client.apps.fromName(appName, { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    const cleanupTask = async () => {
      await provider.delete(sandbox.id);
      client.close();
    };
    cleanup.add(cleanupTask);
    try {
      const result = await sandbox.exec("echo", ["hello"], {
        providerOptions: {
          stdout: "inherit",
          stderr: "inherit",
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toEqual(expect.any(String));
      expect(result.stderr).toEqual(expect.any(String));
    } finally {
      await cleanupTask();
    }
  }, 30000);
});
