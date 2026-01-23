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
    return new SpritesSandbox(idOrName, sprite, this.client);
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
}

const getSpriteUrlAndAuth = (value: unknown): { url: string; auth?: string } => {
  if (!isRecord(value)) {
    throw new ServiceUrlError("service_not_ready", "Sprite details are unavailable.");
  }

  const urlValue = value.url;
  if (typeof urlValue !== "string" || urlValue.length === 0) {
    throw new ServiceUrlError("service_not_ready", "Sprite URL is unavailable.");
  }

  const urlSettings = value.url_settings;
  if (!isRecord(urlSettings)) {
    return { url: urlValue };
  }

  const authValue = urlSettings.auth;
  if (typeof authValue !== "string") {
    return { url: urlValue };
  }

  return { url: urlValue, auth: authValue };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const waitForPortListening = async (
  sandbox: SpritesSandbox,
  port: number,
  timeoutSeconds: number | undefined,
): Promise<void> => {
  const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 0;
  const script = buildPortCheckScript(port, retries);
  const result = await sandbox.exec("sh", ["-c", script]);

  if (result.exitCode === 0) {
    return;
  }
  if (result.exitCode === 2) {
    throw new ServiceUrlError(
      "unsupported",
      "SpritesProvider.getServiceUrl requires ss or lsof to be available in the sprite.",
    );
  }

  throw new ServiceUrlError("port_unavailable", `Port ${port} is not listening inside the sprite.`);
};

const buildPortCheckScript = (port: number, retries: number): string => `
check_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | awk 'NR>1 {found=1} END {exit found?0:1}'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nPiTCP:${port} -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  return 2
}

i=0
while [ $i -le ${retries} ]; do
  check_port
  rc=$?
  if [ $rc -eq 0 ]; then
    exit 0
  fi
  if [ $rc -eq 2 ]; then
    exit 2
  fi
  i=$((i+1))
  if [ $i -le ${retries} ]; then
    sleep 1
  fi
done
exit 1
`;

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
