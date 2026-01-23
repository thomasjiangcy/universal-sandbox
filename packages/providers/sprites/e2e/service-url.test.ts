import { describe, expect, it } from "vitest";

import { ServiceUrlError } from "@usbx/core";

import { SpritesProvider } from "../src/index.js";

describe("sprites e2e service URL", () => {
  it("throws unsupported for getServiceUrl", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = process.env.SPRITES_TOKEN;
    const provider = new SpritesProvider({ token });

    const sandbox = await provider.create({ name });
    try {
      await expect(sandbox.getServiceUrl({ port: 8000 })).rejects.toBeInstanceOf(ServiceUrlError);
      await expect(sandbox.getServiceUrl({ port: 8000 })).rejects.toMatchObject({
        code: "unsupported",
      });
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
