import type {
  ExecOptions as SpritesExecOptions,
  ExecResult as SpritesExecResult,
  SpritesClient,
} from "@fly/sprites";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  ServiceUrl,
  TcpProxyInfo,
} from "@usbx/core";

import { normalizeExitCode, normalizeOutput } from "./internal.js";
import { getSpriteUrlAndAuth, waitForPortListening } from "./internal/sprites.js";
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
  private token: string | undefined;

  constructor(
    idOrName: string,
    sprite: ReturnType<SpritesClient["sprite"]>,
    client: SpritesClient,
    token?: string,
  ) {
    this.id = idOrName;
    this.name = idOrName;
    this.sprite = sprite;
    this.client = client;
    this.token = token;
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
    const spriteInfo: unknown = await this.client.getSprite(this.name ?? this.id);
    const { url: baseUrl, auth } = getSpriteUrlAndAuth(spriteInfo);
    const resolvedVisibility = auth === "public" ? "public" : "private";
    if (options.visibility && options.visibility !== resolvedVisibility) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        `Requested "${options.visibility}" URL, but the sprite is configured for ${resolvedVisibility} access.`,
      );
    }

    await waitForPortListening(this, options.port, options.timeoutSeconds);

    const url = new URL(baseUrl);
    url.port = String(options.port);

    const result: ServiceUrl = {
      url: url.toString(),
      visibility: resolvedVisibility,
    };
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    if (options.visibility === "public") {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "public" TCP proxy, but Sprites proxy requires authentication.',
      );
    }

    const idOrName = this.name ?? this.id;
    const url = `wss://api.sprites.dev/v1/sprites/${idOrName}/proxy`;

    return {
      url,
      ...(this.token ? { headers: { Authorization: `Bearer ${this.token}` } } : {}),
      visibility: "private",
      protocol: "sprites-tcp-proxy-v1",
      init: {
        hostDefault: "localhost",
        requiresHost: false,
      },
    };
  }
}
