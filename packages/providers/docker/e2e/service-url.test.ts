import { describe, expect, it } from "vitest";

import { ServiceUrlError } from "@usbx/core";

import { DockerProvider } from "../src/index.js";

describe("docker e2e service URL", () => {
  it("throws unsupported for getServiceUrl", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provider = new DockerProvider({
      defaultImage: "nginx:alpine",
      defaultCommand: ["nginx", "-g", "daemon off;"],
    });

    const sandbox = await provider.create({ name });
    try {
      await expect(sandbox.getServiceUrl({ port: 80 })).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(sandbox.getServiceUrl({ port: 80 })).rejects.toMatchObject({
        code: "unsupported",
      });
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
