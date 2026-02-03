import { describe, expect, test } from "vitest";
import { DaytonaProvider } from "../src/index.js";
import {
  buildSandboxName,
  getRequiredEnv,
  readFile,
  writeFile,
} from "../../../testing/src/index.js";

const env = getRequiredEnv(["DAYTONA_API_KEY"]);
const describeProvider = env ? describe : describe.skip;

describeProvider("daytona mounts", () => {
  test("mounts a native volume via handle", { timeout: 60_000 }, async () => {
    const provider = new DaytonaProvider({
      config: {
        apiKey: env?.DAYTONA_API_KEY,
        ...(process.env.DAYTONA_API_URL ? { apiUrl: process.env.DAYTONA_API_URL } : {}),
        ...(process.env.DAYTONA_ORG_ID ? { organizationId: process.env.DAYTONA_ORG_ID } : {}),
      },
    });

    const volumeName = buildSandboxName("usbx-e2e-vol");
    const sandboxName = buildSandboxName("usbx-e2e-sbx");
    const volume = await provider.volumes?.create?.({ name: volumeName });
    if (!volume) {
      throw new Error("Daytona volumes.create is not available.");
    }
    await waitForDaytonaVolumeReady(provider, volume.name ?? volume.id ?? volumeName);

    type CreatedSandbox = Awaited<ReturnType<DaytonaProvider["create"]>>;
    let sandbox: CreatedSandbox | undefined;
    let testError: unknown;
    let cleanupError: unknown;
    try {
      sandbox = await provider.create({
        name: sandboxName,
        mounts: [{ handle: volume, mountPath: "/home/daytona/data" }],
      });

      const content = `hello-${Date.now()}`;
      const filePath = "/home/daytona/data/hello.txt";
      await writeFile(sandbox, filePath, content);
      const read = await readFile(sandbox, filePath);
      expect(read).toBe(content);
    } catch (error) {
      testError = error;
    } finally {
      if (sandbox) {
        try {
          await provider.delete(sandbox.id);
        } catch (error) {
          cleanupError = cleanupError ?? error;
        }
      }
      const volumeRef = volume.name ?? volume.id;
      if (volumeRef) {
        try {
          await provider.volumes?.delete?.(volumeRef);
        } catch (error) {
          cleanupError = cleanupError ?? error;
        }
      }
    }

    if (testError) {
      throw testError;
    }
    if (cleanupError) {
      throw cleanupError;
    }
  });
});

const waitForDaytonaVolumeReady = async (
  provider: DaytonaProvider,
  volumeName: string,
): Promise<void> => {
  const timeoutMs = 30_000;
  const intervalMs = 2_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const volume = await provider.native?.volume.get(volumeName);
    const state = volume?.state?.toLowerCase();
    if (state === "ready" || state === "available") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Daytona volume "${volumeName}" did not become ready in time.`);
};
