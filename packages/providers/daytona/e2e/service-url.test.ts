import { describe, expect, it } from "vitest";

import type { ExecResult } from "@usbx/core";
import { ServiceUrlError } from "@usbx/core";

import { DaytonaProvider } from "../src/index.js";

type SandboxWithExec = {
  exec: (command: string, args?: string[]) => Promise<ExecResult>;
};

const waitForHttpOk = async (
  url: string,
  headers: Record<string, string> | undefined,
): Promise<void> => {
  const deadline = Date.now() + 25000;

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

describe("daytona e2e service URL", () => {
  it("returns a public service URL", async () => {
    const provider = new DaytonaProvider({
      createParams: { language: "typescript", public: true },
    });
    const port = 3000;

    const sandbox = await provider.create({ name: `usbx-daytona-public-${Date.now()}` });
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, visibility: "public" });

      expect(result.visibility).toBe("public");
      expect(result.headers).toBeUndefined();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 40000);

  it("returns a private service URL", async () => {
    const provider = new DaytonaProvider({
      createParams: { language: "typescript", public: false },
    });
    const port = 3001;

    const sandbox = await provider.create({ name: `usbx-daytona-private-${Date.now()}` });
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, visibility: "private" });

      expect(result.visibility).toBe("private");
      expect(result.headers?.["x-daytona-preview-token"]).toBeTruthy();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 40000);

  it("throws on public request for private sandbox", async () => {
    const provider = new DaytonaProvider({
      createParams: { language: "typescript", public: false },
    });
    const port = 3004;

    const sandbox = await provider.create({ name: `usbx-daytona-private-public-${Date.now()}` });
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
  }, 40000);

  it("returns a signed private service URL when preferred", async () => {
    const provider = new DaytonaProvider({
      createParams: { language: "typescript", public: false },
      preferSignedUrl: true,
    });
    const port = 3002;

    const sandbox = await provider.create({ name: `usbx-daytona-signed-${Date.now()}` });
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, visibility: "private" });

      expect(result.visibility).toBe("private");
      expect(result.headers).toBeUndefined();
      await waitForHttpOk(result.url, result.headers);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 40000);

  it("throws on visibility mismatch", async () => {
    const provider = new DaytonaProvider({
      createParams: { language: "typescript", public: true },
    });
    const port = 3003;

    const sandbox = await provider.create({ name: `usbx-daytona-mismatch-${Date.now()}` });
    try {
      await startHttpServer(sandbox, port);
      await expect(sandbox.getServiceUrl({ port, visibility: "private" })).rejects.toBeInstanceOf(
        ServiceUrlError,
      );
      await expect(sandbox.getServiceUrl({ port, visibility: "private" })).rejects.toMatchObject({
        code: "visibility_mismatch",
      });
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 40000);
});
