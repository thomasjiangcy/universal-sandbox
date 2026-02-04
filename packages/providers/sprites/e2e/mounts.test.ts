import { describe, expect, test } from "vitest";
import { SpritesProvider } from "../src/index.js";
import {
  buildSandboxName,
  escapeSingleQuoted,
  getR2Env,
  writeFile,
} from "../../../testing/src/index.js";

type CreatedSandbox = Awaited<ReturnType<SpritesProvider["create"]>>;

const r2 = getR2Env();
const hasToken = Boolean(process.env.SPRITES_TOKEN);
const enableEmulated = process.env.SPRITES_EMULATED === "1";
const describeProvider = r2 && hasToken && enableEmulated ? describe : describe.skip;

describeProvider("sprites mounts", () => {
  const buildCommandLine = (command: string, args: string[] = []): string =>
    [command, ...args].map((arg) => `'${escapeSingleQuoted(arg)}'`).join(" ");

  const optionalSudoSpec = (command: string, args: string[] = []) => {
    const commandLine = buildCommandLine(command, args);
    return {
      command: "sh",
      args: [
        "-lc",
        `if command -v sudo >/dev/null 2>&1; then sudo -n ${commandLine}; else ${commandLine}; fi`,
      ],
    };
  };

  const writeWithRetry = async (
    sandbox: CreatedSandbox,
    filePath: string,
    content: string,
    attempts = 5,
    delayMs = 1000,
  ): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const spec = optionalSudoSpec("sh", [
          "-lc",
          `printf '%s' '${escapeSingleQuoted(content)}' > '${filePath}'`,
        ]);
        const result = await sandbox.exec(spec.command, spec.args);
        if (result.exitCode !== 0) {
          throw new Error(result.stderr);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  };

  const readWithRetry = async (
    sandbox: CreatedSandbox,
    filePath: string,
    attempts = 5,
    delayMs = 1000,
  ): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const spec = optionalSudoSpec("cat", [filePath]);
        const result = await sandbox.exec(spec.command, spec.args);
        if (result.exitCode !== 0) {
          throw new Error(result.stderr);
        }
        return result.stdout;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  };

  const createWithRetry = async (
    provider: SpritesProvider,
    buildOptions: (name: string) => Parameters<SpritesProvider["create"]>[0],
    attempts = 3,
    delayMs = 2000,
  ): Promise<CreatedSandbox> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const name = buildSandboxName("usbx-e2e-sbx");
      try {
        return await provider.create(buildOptions(name));
      } catch (error) {
        lastError = error;
        try {
          await provider.delete(name);
        } catch {
          // Ignore cleanup errors between retries.
        }
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  };

  test("mounts R2 bucket via emulation", { timeout: 120_000 }, async () => {
    if (!r2) {
      throw new Error("R2 env missing.");
    }

    const provider = new SpritesProvider({ token: process.env.SPRITES_TOKEN ?? "" });
    let sandbox: CreatedSandbox | undefined;
    let filePath: string | undefined;
    let testError: unknown;
    let cleanupError: unknown;

    try {
      sandbox = await createWithRetry(provider, (name) => ({
        name,
        mounts: [
          {
            type: "emulated",
            mode: "bucket",
            provider: "r2",
            tool: "s3fs",
            mountPath: "/mnt/r2",
            setup: [
              optionalSudoSpec("apt-get", ["update"]),
              optionalSudoSpec("apt-get", ["install", "-y", "s3fs"]),
              optionalSudoSpec("mkdir", ["-p", "/mnt/r2"]),
              optionalSudoSpec("sh", [
                "-lc",
                `printf '%s:%s' '${escapeSingleQuoted(r2.accessKeyId)}' '${escapeSingleQuoted(
                  r2.secretAccessKey,
                )}' > /etc/s3fs.passwd && chmod 600 /etc/s3fs.passwd`,
              ]),
            ],
            command: {
              args: [
                ...optionalSudoSpec("s3fs", [
                  r2.bucket,
                  "/mnt/r2",
                  "-o",
                  "passwd_file=/etc/s3fs.passwd",
                  "-o",
                  `url=${r2.endpoint}`,
                  "-o",
                  "use_path_request_style",
                  "-o",
                  "uid=1001",
                  "-o",
                  "gid=1001",
                  "-o",
                  "dbglevel=info",
                  "-o",
                  "curldbg",
                ]).args,
              ],
              command: "sh",
            },
          },
        ],
      }));

      const content = `hello-${Date.now()}`;
      filePath = `/mnt/r2/usbx-e2e-${Date.now()}.txt`;
      await writeWithRetry(sandbox, filePath, content);
      const read = await readWithRetry(sandbox, filePath);
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
