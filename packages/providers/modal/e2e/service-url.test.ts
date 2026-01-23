import { afterEach, describe, expect, it } from "vitest";

import type { ExecResult } from "@usbx/core";
import { ServiceUrlError } from "@usbx/core";
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

type SandboxWithExec = {
  exec: (command: string, args?: string[]) => Promise<ExecResult>;
};

const waitForHttpOk = async (
  url: string,
  headers: Record<string, string> | undefined,
): Promise<void> => {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient network errors while sandbox warms up.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Service at ${url} did not respond with 200.`);
};

const startHttpServer = async (sandbox: SandboxWithExec, port: number): Promise<void> => {
  await sandbox.exec("sh", ["-c", `python -m http.server ${port} >/tmp/http.log 2>&1 &`]);
};

const createModalSandbox = async (options: ConstructorParameters<typeof ModalProvider>[0]) => {
  const client = getModalClient();
  const app = await client.apps.fromName("usbx-e2e", { createIfMissing: true });
  const provider = new ModalProvider({
    app,
    imageRef: "python:3.13-slim",
    ...options,
  });

  const sandbox = await provider.create();
  return { client, app, provider, sandbox };
};

const cleanupModalSandbox = async (resources: {
  client: ModalClient;
  app: { appId: string };
  provider: ModalProvider;
  sandbox: { id: string };
}) => {
  await resources.provider.delete(resources.sandbox.id);
  try {
    const appStopSource = 1; // AppStopSource.APP_STOP_SOURCE_CLI (not exported)
    await resources.client.cpClient.appStop({
      appId: resources.app.appId,
      source: appStopSource,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Modal app stop failed: ${message}`);
  } finally {
    resources.client.close();
  }
};

describe("modal e2e service URL", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("returns a public service URL", async () => {
    const resources = await createModalSandbox({
      sandboxOptions: { encryptedPorts: [8080] },
    });
    cleanup.add(() => cleanupModalSandbox(resources));
    try {
      await startHttpServer(resources.sandbox, 8080);
      const result = await resources.sandbox.getServiceUrl({ port: 8080, visibility: "public" });

      expect(result.visibility).toBe("public");
      expect(result.headers).toBeUndefined();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await cleanupModalSandbox(resources);
    }
  }, 40000);

  it("returns a private service URL", async () => {
    const resources = await createModalSandbox({});
    cleanup.add(() => cleanupModalSandbox(resources));
    try {
      await startHttpServer(resources.sandbox, 8080);
      const result = await resources.sandbox.getServiceUrl({ port: 8080, visibility: "private" });

      expect(result.visibility).toBe("private");
      expect(result.headers?.Authorization).toBeTruthy();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await cleanupModalSandbox(resources);
    }
  }, 40000);

  it("returns a query-authenticated private service URL", async () => {
    const resources = await createModalSandbox({ authMode: "query" });
    cleanup.add(() => cleanupModalSandbox(resources));
    try {
      await startHttpServer(resources.sandbox, 8080);
      const result = await resources.sandbox.getServiceUrl({ port: 8080, visibility: "private" });

      expect(result.visibility).toBe("private");
      expect(result.headers).toBeUndefined();
      expect(result.url).toContain("_modal_connect_token=");
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await cleanupModalSandbox(resources);
    }
  }, 40000);

  it("throws on port mismatch for private URLs", async () => {
    const resources = await createModalSandbox({});
    cleanup.add(() => cleanupModalSandbox(resources));
    try {
      await expect(
        resources.sandbox.getServiceUrl({ port: 3000, visibility: "private" }),
      ).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(
        resources.sandbox.getServiceUrl({ port: 3000, visibility: "private" }),
      ).rejects.toMatchObject({
        code: "port_unavailable",
      });
    } finally {
      await cleanupModalSandbox(resources);
    }
  }, 40000);
});
