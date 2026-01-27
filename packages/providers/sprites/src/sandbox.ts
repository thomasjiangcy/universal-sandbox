import type {
  ExecOptions as SpritesExecOptions,
  ExecResult as SpritesExecResult,
  SpritesClient,
} from "@fly/sprites";
import type { ExecOptions, ExecResult, ExecStream, Sandbox, SandboxId } from "@usbx/core";

import { normalizeExitCode, normalizeOutput } from "./internal.js";
import { nodeReadableToWeb, nodeWritableToWeb, writeToNodeStream } from "./internal/streams.js";

export class SpritesSandbox implements Sandbox<
  ReturnType<SpritesClient["sprite"]>,
  SpritesExecOptions
> {
  id: SandboxId;
  name?: string;
  native: ReturnType<SpritesClient["sprite"]>;

  private sprite: ReturnType<SpritesClient["sprite"]>;
  private client: SpritesClient;

  constructor(
    idOrName: string,
    sprite: ReturnType<SpritesClient["sprite"]>,
    client: SpritesClient,
  ) {
    this.id = idOrName;
    this.name = idOrName;
    this.sprite = sprite;
    this.client = client;
    this.native = sprite;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<SpritesExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("SpritesProvider.exec does not support stdin; use native for streaming.");
    }

    const providerOptions = options?.providerOptions;

    const result: SpritesExecResult = await this.sprite.execFile(command, args, providerOptions);

    return {
      stdout: normalizeOutput(result.stdout),
      stderr: normalizeOutput(result.stderr),
      exitCode: normalizeExitCode(result.exitCode),
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<SpritesExecOptions>,
  ): Promise<ExecStream> {
    const providerOptions = options?.providerOptions;
    const cmd = this.sprite.spawn(command, args, providerOptions);

    cmd.on("exit", () => {
      cmd.stdout.destroy();
      cmd.stderr.destroy();
    });

    cmd.on("error", (error) => {
      cmd.stdout.destroy(error);
      cmd.stderr.destroy(error);
    });

    if (options?.stdin !== undefined) {
      await writeToNodeStream(cmd.stdin, options.stdin);
    }

    return {
      stdout: nodeReadableToWeb(cmd.stdout),
      stderr: nodeReadableToWeb(cmd.stderr),
      stdin: nodeWritableToWeb(cmd.stdin),
      exitCode: cmd.wait().then((code) => (Number.isFinite(code) ? code : null)),
    };
  }
}
