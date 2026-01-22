import { describe, expect, it } from "vitest";

import { DockerProvider } from "../src/index.js";

describe("docker e2e create-exec", () => {
  it("creates a container and runs a command", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const image = process.env.DOCKER_IMAGE ?? "alpine";
    const provider = new DockerProvider({ defaultImage: image });

    const sandbox = await provider.create({ name });
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
    } finally {
      await sandbox.native.remove({ force: true });
    }
  }, 20000);
});
