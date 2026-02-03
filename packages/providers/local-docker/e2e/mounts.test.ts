import { describe, expect, test } from "vitest";
import { LocalDockerProvider } from "../src/index.js";
import {
  buildSandboxName,
  escapeSingleQuoted,
  getR2Env,
  readFile,
  writeFile,
} from "../../../testing/src/index.js";

describe("local docker mounts", () => {
  test("mounts a native volume via handle", { timeout: 60_000 }, async () => {
    const provider = new LocalDockerProvider({ defaultImage: "alpine:3.20" });
    const volumeName = buildSandboxName("usbx-e2e-vol");
    const sandboxName = buildSandboxName("usbx-e2e-sbx");
    const volume = await provider.volumes?.create?.({ name: volumeName });
    if (!volume) {
      throw new Error("LocalDocker volumes.create is not available.");
    }

    type CreatedSandbox = Awaited<ReturnType<LocalDockerProvider["create"]>>;
    let sandbox: CreatedSandbox | undefined;
    let testError: unknown;
    let cleanupError: unknown;
    try {
      sandbox = await provider.create({
        name: sandboxName,
        mounts: [{ handle: volume, mountPath: "/mnt/data" }],
      });

      const content = `hello-${Date.now()}`;
      const filePath = "/mnt/data/hello.txt";
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
      try {
        await provider.volumes?.delete?.(volume.id);
      } catch (error) {
        cleanupError = cleanupError ?? error;
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
  const canEmulate = process.env.LOCAL_DOCKER_FUSE === "1" && r2;
  const describeEmulated = canEmulate ? describe : describe.skip;

  describeEmulated("emulated bucket mount", () => {
    test("mounts R2 via s3fs", { timeout: 120_000 }, async () => {
      if (!r2) {
        throw new Error("R2 env missing.");
      }

      const provider = new LocalDockerProvider({
        defaultImage: "ubuntu:24.04",
        hostConfig: {
          Privileged: true,
          Devices: [
            { PathOnHost: "/dev/fuse", PathInContainer: "/dev/fuse", CgroupPermissions: "rwm" },
          ],
        },
      });

      const sandboxName = buildSandboxName("usbx-e2e-sbx");
      type CreatedSandbox = Awaited<ReturnType<LocalDockerProvider["create"]>>;
      let sandbox: CreatedSandbox | undefined;
      let filePath: string | undefined;
      let testError: unknown;
      let cleanupError: unknown;
      try {
        sandbox = await provider.create({
          name: sandboxName,
          mounts: [
            {
              type: "emulated",
              mode: "bucket",
              provider: "r2",
              tool: "s3fs",
              mountPath: "/mnt/r2",
              setup: [
                { command: "apt-get", args: ["update"] },
                { command: "apt-get", args: ["install", "-y", "s3fs"] },
                { command: "mkdir", args: ["-p", "/mnt/r2"] },
                {
                  command: "sh",
                  args: [
                    "-lc",
                    `printf '%s:%s' '${escapeSingleQuoted(r2.accessKeyId)}' '${escapeSingleQuoted(
                      r2.secretAccessKey,
                    )}' > /etc/s3fs.passwd && chmod 600 /etc/s3fs.passwd`,
                  ],
                },
              ],
              command: {
                command: "s3fs",
                args: [
                  r2.bucket,
                  "/mnt/r2",
                  "-o",
                  "passwd_file=/etc/s3fs.passwd",
                  "-o",
                  `url=${r2.endpoint}`,
                  "-o",
                  "use_path_request_style",
                ],
              },
            },
          ],
        });

        const content = `hello-${Date.now()}`;
        filePath = `/mnt/r2/usbx-e2e-${Date.now()}.txt`;
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
