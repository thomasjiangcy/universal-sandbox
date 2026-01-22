import { describe, expect, it } from "vitest";

import { ModalClient } from "modal";

import { ModalProvider } from "../src/index.js";

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
      await sandbox.native.terminate();
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
      await sandbox.native.terminate();
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
