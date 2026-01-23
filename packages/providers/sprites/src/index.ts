import { SpritesClient } from "@fly/sprites";
import { Readable, Writable } from "node:stream";
import type {
  ExecOptions as SpritesExecOptions,
  ExecResult as SpritesExecResult,
} from "@fly/sprites";
import { ServiceUrlError } from "@usbx/core";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  Sandbox,
  SandboxId,
  SandboxProvider,
  ServiceUrl,
} from "@usbx/core";
import { normalizeExitCode, normalizeOutput } from "./internal.js";

export type SpritesProviderOptions = {
  token?: string;
  client?: SpritesClient;
};

export class SpritesProvider implements SandboxProvider<
  ReturnType<SpritesClient["sprite"]>,
  SpritesClient,
  SpritesExecOptions
> {
  private client: SpritesClient;

  native: SpritesClient;

  constructor(options: SpritesProviderOptions) {
    if (options.client) {
      this.client = options.client;
      this.native = options.client;
      return;
    }

    if (!options.token) {
      throw new Error("SpritesProvider requires a token or a client.");
    }

    this.client = new SpritesClient(options.token);
    this.native = this.client;
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>> {
    if (!options?.name) {
      throw new Error("SpritesProvider.create requires a name.");
    }

    await this.client.createSprite(options.name);
    return this.get(options.name);
  }

  async get(
    idOrName: string,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>> {
    const sprite = this.client.sprite(idOrName);
    return new SpritesSandbox(idOrName, sprite);
  }

  async delete(idOrName: string): Promise<void> {
    await this.client.deleteSprite(idOrName);
  }
}

class SpritesSandbox implements Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions> {
  id: SandboxId;
  name?: string;
  native: ReturnType<SpritesClient["sprite"]>;

  private sprite: ReturnType<SpritesClient["sprite"]>;

  constructor(idOrName: string, sprite: ReturnType<SpritesClient["sprite"]>) {
    this.id = idOrName;
    this.name = idOrName;
    this.sprite = sprite;
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

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    throw new ServiceUrlError(
      "unsupported",
      `SpritesProvider.getServiceUrl is currently unsupported (requested port ${options.port}).`,
    );
  }
}

const writeToNodeStream = async (stream: Writable, input: string | Uint8Array): Promise<void> => {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;

  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.end(buffer, resolve);
  });
};

const nodeReadableToWeb = (stream: Readable): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => {
        if (typeof chunk === "string") {
          controller.enqueue(new TextEncoder().encode(chunk));
          return;
        }
        controller.enqueue(Buffer.isBuffer(chunk) ? chunk : new Uint8Array(chunk));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (error: Error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });

const nodeWritableToWeb = (stream: Writable): WritableStream<Uint8Array> =>
  new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        stream.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        stream.once("error", (error: Error) => reject(error));
        stream.end(() => resolve());
      });
    },
    abort(reason) {
      stream.destroy(reason instanceof Error ? reason : undefined);
    },
  });
