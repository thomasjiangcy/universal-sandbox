import { SpritesClient } from "@fly/sprites";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxId,
  SandboxProvider,
} from "@usbx/core";

export type SpritesProviderOptions = {
  token?: string;
  client?: SpritesClient;
};

type SpritesExecResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};

export class SpritesProvider implements SandboxProvider<
  ReturnType<SpritesClient["sprite"]>,
  SpritesClient,
  Record<string, unknown>
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
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, Record<string, unknown>>> {
    if (!options?.name) {
      throw new Error("SpritesProvider.create requires a name.");
    }

    await this.client.createSprite(options.name);
    return this.get(options.name);
  }

  async get(
    idOrName: string,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, Record<string, unknown>>> {
    const sprite = this.client.sprite(idOrName);
    return new SpritesSandbox(idOrName, sprite);
  }
}

class SpritesSandbox implements Sandbox<
  ReturnType<SpritesClient["sprite"]>,
  Record<string, unknown>
> {
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
    options?: ExecOptions<Record<string, unknown>>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("SpritesProvider.exec does not support stdin; use native for streaming.");
    }

    const providerOptions = options?.providerOptions;

    const result = (await this.sprite.execFile(
      command,
      args,
      providerOptions,
    )) as SpritesExecResult;

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? null,
    };
  }
}
