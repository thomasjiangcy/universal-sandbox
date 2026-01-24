import { afterEach, describe, expect, it } from "vitest";

import { ServiceUrlError } from "@usbx/core";

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

const waitForHttpOk = async (url: string, timeoutMs = 15000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient network errors while nginx starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Service at ${url} did not respond with 200.`);
};

describe("local-docker e2e service URL", () => {
  const cleanup = createCleanup();

  afterEach(async () => {
    await cleanup.run();
  });

  it("returns a local service URL for a published port", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provider = new LocalDockerProvider({
      defaultImage: "nginx:alpine",
      defaultCommand: ["nginx", "-g", "daemon off;"],
      portExposure: { ports: [80], publishMode: "random" },
    });

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));
    try {
      const result = await sandbox.getServiceUrl({ port: 80 });
      expect(result.visibility).toBe("private");
      await waitForHttpOk(result.url);
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);

  it("throws when the port is not published", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provider = new LocalDockerProvider({
      defaultImage: "nginx:alpine",
      defaultCommand: ["nginx", "-g", "daemon off;"],
      portExposure: { ports: [80], publishMode: "random" },
    });

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));
    try {
      await expect(sandbox.getServiceUrl({ port: 81 })).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(sandbox.getServiceUrl({ port: 81 })).rejects.toMatchObject({
        code: "port_unavailable",
      });
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);

  it("throws when requesting a public URL", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provider = new LocalDockerProvider({
      defaultImage: "nginx:alpine",
      defaultCommand: ["nginx", "-g", "daemon off;"],
      portExposure: { ports: [80], publishMode: "random" },
    });

    const sandbox = await provider.create({ name });
    cleanup.add(() => provider.delete(sandbox.id));
    try {
      await expect(
        sandbox.getServiceUrl({ port: 80, visibility: "public" }),
      ).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(sandbox.getServiceUrl({ port: 80, visibility: "public" })).rejects.toMatchObject(
        {
          code: "tunnel_unavailable",
        },
      );
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
