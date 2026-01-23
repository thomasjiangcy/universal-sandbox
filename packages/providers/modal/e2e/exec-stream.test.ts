import { afterEach, describe, expect, it } from "vitest";

import { ModalClient } from "modal";

import { ModalProvider } from "../src/index.js";

const getModalClient = (): ModalClient => {
  const tokenId = process.env.MODAL_TOKEN_ID;
  const tokenSecret = process.env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error("Modal credentials missing: set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.");
  }
  return new ModalClient({ tokenId, tokenSecret });
};

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

describe("modal e2e execStream", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("streams a command", async () => {
    const client = getModalClient();
    const app = await client.apps.fromName("usbx-e2e", { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    const cleanupTask = async () => {
      await provider.delete(sandbox.id);
      try {
        const appStopSource = 1; // AppStopSource.APP_STOP_SOURCE_CLI (not exported)
        await client.cpClient.appStop({
          appId: app.appId,
          source: appStopSource,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Modal app stop failed: ${message}`);
      } finally {
        client.close();
      }
    };
    cleanup.add(cleanupTask);
    try {
      const result = await sandbox.execStream("echo", ["hello"]);
      const stdout = await readStreamText(result.stdout);

      await expect(result.exitCode).resolves.toBe(0);
      expect(stdout).toContain("hello");
    } finally {
      await cleanupTask();
    }
  }, 30000);
});
