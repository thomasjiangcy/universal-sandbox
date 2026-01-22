import { describe, expect, it } from "vitest";

import { SpritesProvider } from "../src/index.js";

describe("sprites e2e create-exec", () => {
  it("creates a sprite and runs a command", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = process.env.SPRITES_TOKEN;
    const provider = new SpritesProvider({ token });

    let sandbox = await provider.create({ name });
    try {
      const result = await sandbox.exec("echo", ["hello"]);
      expect(result.stdout).toContain("hello");
      expect(result.exitCode).toBe(0);
    } finally {
      await provider.native.deleteSprite(name);
    }
  }, 20000);
});
