import { describe, expect, it } from "vitest";

import { ModalClient } from "modal";

import { ModalProvider } from "../src/index.js";

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

describe("modal e2e create-exec", () => {
  it("creates a sandbox and runs a command", async () => {
    const client = new ModalClient();
    const app = await client.apps.fromName("usbx-e2e", { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
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
    }
  }, 30000);

  it("streams a command", async () => {
    const client = new ModalClient();
    const app = await client.apps.fromName("usbx-e2e", { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
    try {
      const result = await sandbox.execStream("echo", ["hello"]);
      const stdout = await readStreamText(result.stdout);

      await expect(result.exitCode).resolves.toBe(0);
      expect(stdout).toContain("hello");
    } finally {
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
    }
  }, 30000);

  it("handles inherit stdout and stderr", async () => {
    const client = new ModalClient();
    const app = await client.apps.fromName("usbx-e2e", { createIfMissing: true });
    const provider = new ModalProvider({
      app,
      imageRef: "python:3.13-slim",
    });

    const sandbox = await provider.create();
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
    }
  }, 30000);
});
