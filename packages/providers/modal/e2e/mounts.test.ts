import { describe, expect, test } from "vitest";
import { ModalClient } from "modal";
import { ModalProvider } from "../src/index.js";
import {
  buildSandboxName,
  getR2Env,
  getRequiredEnv,
  readFile,
  writeFile,
} from "../../../testing/src/index.js";

const env = getRequiredEnv(["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET", "MODAL_APP_NAME"]);
const describeProvider = env ? describe : describe.skip;

describeProvider("modal mounts", () => {
  const modalClient = new ModalClient({
    tokenId: env?.MODAL_TOKEN_ID,
    tokenSecret: env?.MODAL_TOKEN_SECRET,
  });

  const provider = new ModalProvider({
    client: modalClient,
    appName: env?.MODAL_APP_NAME,
    imageRef: process.env.MODAL_IMAGE_REF ?? "python:3.13-slim",
  });

  test("mounts a native volume via handle", { timeout: 60_000 }, async () => {
    const volumeName = buildSandboxName("usbx-e2e-vol");
    const sandboxName = buildSandboxName("usbx-e2e-sbx");
    const volume = await provider.volumes?.create?.({ name: volumeName });
    if (!volume) {
      throw new Error("Modal volumes.create is not available.");
    }

    type CreatedSandbox = Awaited<ReturnType<ModalProvider["create"]>>;
    let sandbox: CreatedSandbox | undefined;
    let testError: unknown;
    let cleanupError: unknown;
    try {
      sandbox = await provider.create({
        name: sandboxName,
        mounts: [{ handle: volume, mountPath: "/mnt/volume" }],
      });

      const content = `hello-${Date.now()}`;
      const filePath = "/mnt/volume/hello.txt";
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

  const r2 = getR2Env();
  const modalSecretName = process.env.MODAL_R2_SECRET;
  const describeBucket = r2 && modalSecretName ? describe : describe.skip;

  describeBucket("bucket mounts", () => {
    test("mounts R2 bucket natively", { timeout: 60_000 }, async () => {
      if (!r2 || !modalSecretName) {
        throw new Error("R2 env or Modal secret missing.");
      }

      const sandboxName = buildSandboxName("usbx-e2e-sbx");
      type CreatedSandbox = Awaited<ReturnType<ModalProvider["create"]>>;
      let sandbox: CreatedSandbox | undefined;
      let filePath: string | undefined;
      let testError: unknown;
      let cleanupError: unknown;
      try {
        sandbox = await provider.create({
          name: sandboxName,
          mounts: [
            {
              type: "bucket",
              provider: "r2",
              bucket: r2.bucket,
              mountPath: "/mnt/bucket",
              credentialsRef: modalSecretName,
              endpointUrl: r2.endpoint,
            },
          ],
        });

        const content = `hello-${Date.now()}`;
        filePath = `/mnt/bucket/usbx-e2e-${Date.now()}.txt`;
        await writeFile(sandbox, filePath, content);
        const read = await readFile(sandbox, filePath);
        expect(read).toBe(content);
      } catch (error) {
        testError = error;
      } finally {
        if (sandbox) {
          if (filePath) {
            try {
              await sandbox.exec("sh", ["-lc", `rm -f '${filePath}'`]);
            } catch {
              // Ignore cleanup errors for bucket contents.
            }
          }
          try {
            await provider.delete(sandbox.id);
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
});
