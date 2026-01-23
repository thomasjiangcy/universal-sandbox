import { describe, expect, it } from "vitest";

import type { ExecResult } from "@usbx/core";
import { ServiceUrlError } from "@usbx/core";

import { E2BProvider } from "../src/index.js";

const waitForHttpOk = async (
  url: string,
  headers: Record<string, string> | undefined,
): Promise<void> => {
  const deadline = Date.now() + 20000;

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

type SandboxWithExec = {
  exec: (command: string, args?: string[]) => Promise<ExecResult>;
};

const startHttpServer = async (sandbox: SandboxWithExec, port: number): Promise<void> => {
  await sandbox.exec("sh", ["-c", `python -m http.server ${port} >/tmp/http.log 2>&1 &`]);
};

describe("e2b e2e service URL", () => {
  it("returns a public service URL", async () => {
    const provider = new E2BProvider({ allowPublicTraffic: true });
    const port = 8000;

    const sandbox = await provider.create();
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, visibility: "public" });

      expect(result.visibility).toBe("public");
      expect(result.headers).toBeUndefined();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);

  it("returns a private service URL", async () => {
    const provider = new E2BProvider({ allowPublicTraffic: false });
    const port = 8001;

    const sandbox = await provider.create();
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, visibility: "private" });

      expect(result.visibility).toBe("private");
      expect(result.headers?.["e2b-traffic-access-token"]).toBeTruthy();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);

  it("defaults to private when traffic token is present", async () => {
    const creator = new E2BProvider({ allowPublicTraffic: false });
    const connector = new E2BProvider();
    const port = 8004;

    const sandbox = await creator.create();
    try {
      await startHttpServer(sandbox, port);
      const connected = await connector.get(sandbox.id);
      const result = await connected.getServiceUrl({ port });

      expect(result.visibility).toBe("private");
      expect(result.headers?.["e2b-traffic-access-token"]).toBeTruthy();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await creator.delete(sandbox.id);
    }
  }, 30000);

  it("throws on visibility mismatch", async () => {
    const provider = new E2BProvider({ allowPublicTraffic: false });
    const port = 8002;

    const sandbox = await provider.create();
    try {
      await startHttpServer(sandbox, port);
      await expect(sandbox.getServiceUrl({ port, visibility: "public" })).rejects.toBeInstanceOf(
        ServiceUrlError,
      );
      await expect(sandbox.getServiceUrl({ port, visibility: "public" })).rejects.toMatchObject({
        code: "visibility_mismatch",
      });
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);

  it("throws on visibility mismatch when allowPublicTraffic is unset", async () => {
    const creator = new E2BProvider({ allowPublicTraffic: true });
    const connector = new E2BProvider();
    const port = 8003;

    const sandbox = await creator.create();
    try {
      const connected = await connector.get(sandbox.id);
      const promise = connected.getServiceUrl({ port, visibility: "private" });

      await expect(promise).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(promise).rejects.toMatchObject({
        code: "visibility_mismatch",
      });
    } finally {
      await creator.delete(sandbox.id);
    }
  }, 30000);
});
