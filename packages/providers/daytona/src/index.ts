import { Daytona } from "@daytonaio/sdk";
import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  DaytonaConfig,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
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

export type DaytonaServiceUrlOptions = {
  preferSignedUrl?: boolean;
};

export type DaytonaProviderOptions = {
  client?: Daytona;
  config?: DaytonaConfig;
  createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  createOptions?: {
    timeout?: number;
    onSnapshotCreateLogs?: (chunk: string) => void;
  };
} & DaytonaServiceUrlOptions;

type DaytonaExecOptions = never;

type DaytonaCreateParams = CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;

const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

const buildShellCommand = (
  command: string,
  args: string[],
  options?: ExecOptions<DaytonaExecOptions>,
): string => {
  const baseCommand = buildCommand(command, args);
  const envEntries = options?.env ? Object.entries(options.env) : [];
  const envPrefix =
    envEntries.length > 0
      ? `env ${envEntries.map(([key, value]) => `${key}=${escapeShellArg(value)}`).join(" ")} `
      : "";
  const commandWithEnv = `${envPrefix}${baseCommand}`;

  const commandWithStdin =
    options?.stdin !== undefined
      ? `printf '%s' '${stdinToBase64(options.stdin)}' | base64 -d | ${commandWithEnv}`
      : commandWithEnv;

  if (options?.cwd) {
    return `cd ${escapeShellArg(options.cwd)} && ${commandWithStdin}`;
  }

  return commandWithStdin;
};

const stdinToBase64 = (stdin: string | Uint8Array): string =>
  (typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin)).toString("base64");

const createTextStream = () => {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const enqueue = (chunk: string) => {
    if (!controller) {
      return;
    }
    controller.enqueue(encoder.encode(chunk));
  };

  const close = () => {
    controller?.close();
  };

  const error = (err: unknown) => {
    controller?.error(err);
  };

  return {
    readable,
    enqueue,
    close,
    error,
  };
};

export class DaytonaProvider implements SandboxProvider<
  DaytonaSandboxClient,
  Daytona,
  DaytonaExecOptions
> {
  private client: Daytona;
  private createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  private createOptions?: DaytonaProviderOptions["createOptions"];
  private preferSignedUrl: boolean;

  native: Daytona;

  constructor(options: DaytonaProviderOptions = {}) {
    this.client = options.client ?? new Daytona(options.config);
    this.native = this.client;
    if (options.createParams !== undefined) {
      this.createParams = options.createParams;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
    this.preferSignedUrl = options.preferSignedUrl ?? false;
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    let createParams: DaytonaCreateParams | undefined = this.createParams
      ? { ...this.createParams }
      : undefined;
    if (options?.name) {
      createParams = createParams
        ? { ...createParams, name: options.name }
        : { name: options.name };
    }

    const sandbox = await this.client.create(createParams, this.createOptions);
    return new DaytonaSandbox(sandbox, this.preferSignedUrl);
  }

  async get(idOrName: string): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    const sandbox = await this.client.get(idOrName);
    return new DaytonaSandbox(sandbox, this.preferSignedUrl);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await this.client.get(idOrName);
    await this.client.delete(sandbox);
  }
}

class DaytonaSandbox implements Sandbox<DaytonaSandboxClient, DaytonaExecOptions> {
  id: SandboxId;
  name?: string;
  native: DaytonaSandboxClient;

  private sandbox: DaytonaSandboxClient;
  private preferSignedUrl: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: DaytonaSandboxClient, preferSignedUrl: boolean) {
    this.id = sandbox.id;
    this.name = sandbox.name;
    this.sandbox = sandbox;
    this.preferSignedUrl = preferSignedUrl;
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("DaytonaProvider.exec does not support stdin.");
    }

    const commandString = buildCommand(command, args);
    const result = await this.sandbox.process.executeCommand(
      commandString,
      options?.cwd,
      options?.env,
      options?.timeoutSeconds,
    );

    return {
      stdout: result.artifacts?.stdout ?? result.result ?? "",
      stderr: "",
      exitCode: result.exitCode ?? null,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecStream> {
    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const sessionId = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.sandbox.process.createSession(sessionId);

    const commandString = buildShellCommand(command, args, options);
    const response = await this.sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: commandString,
        runAsync: true,
      },
      options?.timeoutSeconds,
    );

    if (!response.cmdId) {
      await this.sandbox.process.deleteSession(sessionId);
      throw new Error("DaytonaProvider.execStream did not return a command id.");
    }

    const logsPromise = this.sandbox.process.getSessionCommandLogs(
      sessionId,
      response.cmdId,
      (chunk) => stdoutStream.enqueue(chunk),
      (chunk) => stderrStream.enqueue(chunk),
    );

    logsPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    const exitCode = logsPromise
      .then(async () => {
        const commandInfo = await this.sandbox.process.getSessionCommand(sessionId, response.cmdId);
        return commandInfo.exitCode ?? null;
      })
      .finally(async () => {
        try {
          await this.sandbox.process.deleteSession(sessionId);
        } catch {
          // Best-effort cleanup.
        }
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode,
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility = options.visibility ?? (this.sandbox.public ? "public" : "private");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "private" && this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox is public. Create a private sandbox or use a signed preview URL if supported.',
      );
    }
    if (resolvedVisibility === "public" && !this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox is private. Create a public sandbox or request a private URL.',
      );
    }

    const previewInfo = await this.sandbox.getPreviewLink(options.port);
    let result: ServiceUrl;

    if (resolvedVisibility === "public") {
      result = {
        url: previewInfo.url,
        visibility: "public",
      };
    } else if (this.preferSignedUrl) {
      const signedPreview = await this.sandbox.getSignedPreviewUrl(options.port);
      result = {
        url: signedPreview.url,
        visibility: "private",
      };
    } else {
      result = {
        url: previewInfo.url,
        headers: { "x-daytona-preview-token": previewInfo.token },
        visibility: "private",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }
}
