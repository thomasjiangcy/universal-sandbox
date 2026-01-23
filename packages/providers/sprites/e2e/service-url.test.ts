import { describe, expect, it } from "vitest";

import { SpritesProvider } from "../src/index.js";

describe("sprites e2e service URL", () => {
  const startHttpServer = async (
    sandbox: { exec: (command: string, args?: string[]) => Promise<unknown> },
    port: number,
  ): Promise<void> => {
    await sandbox.exec("sh", [
      "-c",
      `if command -v python3 >/dev/null 2>&1; then \
python3 -m http.server ${port} >/tmp/http.log 2>&1 & \
elif command -v python >/dev/null 2>&1; then \
python -m http.server ${port} >/tmp/http.log 2>&1 & \
else \
echo "python is required for this test" >&2; exit 1; \
fi`,
    ]);
  };

  it("returns a service URL when the port is listening", async () => {
    const name = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = process.env.SPRITES_TOKEN;
    const provider = new SpritesProvider({ token });
    const port = 8000;

    const sandbox = await provider.create({ name });
    try {
      await startHttpServer(sandbox, port);
      const result = await sandbox.getServiceUrl({ port, timeoutSeconds: 10 });

      expect(result.visibility).toBe("private");
      const parsed = new URL(result.url);
      expect(parsed.port).toBe(String(port));
    } finally {
      await provider.delete(sandbox.id);
    }
  }, 30000);
});
