import { describe, expect, test } from "vitest";
import { SpritesProvider } from "../src/index.js";
import {
  buildSandboxName,
  escapeSingleQuoted,
  getR2Env,
  readFile,
  writeFile,
} from "../../../testing/src/index.js";

const r2 = getR2Env();
const hasToken = Boolean(process.env.SPRITES_TOKEN);
const enableEmulated = process.env.SPRITES_EMULATED === "1";
const describeProvider = r2 && hasToken && enableEmulated ? describe : describe.skip;

describeProvider("sprites mounts", () => {
  test("mounts R2 bucket via emulation", { timeout: 120_000 }, async () => {
    if (!r2) {
      throw new Error("R2 env missing.");
    }

    const provider = new SpritesProvider({ token: process.env.SPRITES_TOKEN ?? "" });
    const sandboxName = buildSandboxName("usbx-e2e-sbx");
    type CreatedSandbox = Awaited<ReturnType<SpritesProvider["create"]>>;
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
