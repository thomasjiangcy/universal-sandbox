import { describe, expect, test } from "vitest";
import { ApiClient, ConnectionConfig, Template } from "e2b";
import { E2BProvider } from "../src/index.js";
import { escapeSingleQuoted, getR2Env } from "../../../testing/src/index.js";

const r2 = getR2Env();
const hasE2bKey = Boolean(process.env.E2B_API_KEY);
const enableEmulated = process.env.E2B_EMULATED === "1";
const describeProvider = r2 && hasE2bKey && enableEmulated ? describe : describe.skip;

describeProvider("e2b mounts", () => {
  const deleteTemplate = async (templateId: string): Promise<void> => {
    const config = new ConnectionConfig({ apiKey: process.env.E2B_API_KEY });
    const client = new ApiClient(config, { requireApiKey: true });
    const res = await client.api.DELETE("/templates/{templateID}", {
      params: { path: { templateID: templateId } },
      signal: config.getSignal(),
    });
    if (res.error && res.response?.status !== 404) {
      const message =
        typeof res.error === "object" && res.error && "message" in res.error
          ? String(res.error.message)
          : String(res.error);
      throw new Error(`Template delete failed (${res.response?.status ?? "unknown"}): ${message}`);
    }
  };

  test("mounts R2 bucket via emulation", { timeout: 120_000 }, async () => {
    if (!r2) {
      throw new Error("R2 env missing.");
    }

    const provider = new E2BProvider({ createOptions: { allowInternetAccess: true } });
    const templateAlias = `usbx-e2e-s3fs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const template = Template().fromImage("ubuntu:latest").aptInstall(["s3fs"]);
    const built = await Template.build(template, { alias: templateAlias });

    type CreatedSandbox = Awaited<ReturnType<E2BProvider["create"]>>;
    let sandbox: CreatedSandbox | undefined;
    let filePath: string | undefined;
    let templateId: string | undefined;
    let testError: unknown;
    let cleanupError: unknown;

    try {
      templateId = built.templateId;
      sandbox = await provider.create({
        image: {
          provider: "e2b",
          kind: "template",
          id: built.templateId,
          metadata: { alias: built.alias },
        },
        mounts: [
          {
            type: "emulated",
            mode: "bucket",
            provider: "r2",
            tool: "s3fs",
            mountPath: "/home/user/bucket",
            setup: [
              { command: "sudo", args: ["mkdir", "-p", "/home/user/bucket"] },
              {
                command: "sudo",
                args: [
                  "sh",
                  "-lc",
                  `printf '%s:%s' '${escapeSingleQuoted(r2.accessKeyId)}' '${escapeSingleQuoted(
                    r2.secretAccessKey,
                  )}' > /root/.passwd-s3fs`,
                ],
              },
              { command: "sudo", args: ["chmod", "600", "/root/.passwd-s3fs"] },
            ],
            command: {
              command: "sh",
              args: [
                "-lc",
                `sudo s3fs -o url=${escapeSingleQuoted(
                  r2.endpoint,
                )} -o use_path_request_style -o allow_other ${escapeSingleQuoted(
                  r2.bucket,
                )} /home/user/bucket`,
              ],
            },
          },
        ],
      });

      const mountCheck = await sandbox.exec("sh", [
        "-lc",
        "mount | awk '$3==\"/home/user/bucket\" {print}' || true",
      ]);
      if (!mountCheck.stdout.trim()) {
        throw new Error("s3fs mount did not appear.");
      }

      const content = `hello-${Date.now()}`;
      filePath = `/home/user/bucket/usbx-e2e-${Date.now()}.txt`;
      const write = await sandbox.exec("sudo", [
        "sh",
        "-lc",
        `printf '%s' '${escapeSingleQuoted(content)}' > '${filePath}'`,
      ]);
      if (write.exitCode !== 0) {
        throw new Error(`write failed: ${write.stderr}`);
      }
      const read = await sandbox.exec("sudo", ["sh", "-lc", `cat '${filePath}'`]);
      if (read.exitCode !== 0) {
        throw new Error(`read failed: ${read.stderr}`);
      }
      expect(read.stdout).toBe(content);
    } catch (error) {
      testError = error;
    } finally {
      if (sandbox) {
        if (filePath) {
          try {
            await sandbox.exec("sudo", ["sh", "-lc", `rm -f '${filePath}'`]);
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
      if (templateId) {
        try {
          await deleteTemplate(templateId);
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
