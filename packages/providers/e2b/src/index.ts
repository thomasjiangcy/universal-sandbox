import { Sandbox as E2BSandboxClient } from "e2b";
import type { CommandStartOpts, SandboxConnectOpts, SandboxOpts } from "e2b";
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

export type E2BServiceUrlOptions = {
  allowPublicTraffic?: boolean;
};

export type E2BProviderOptions = {
  template?: string;
  createOptions?: SandboxOpts;
  connectOptions?: SandboxConnectOpts;
} & E2BServiceUrlOptions;

export type E2BExecOptions = Omit<
  CommandStartOpts,
  "background" | "cwd" | "envs" | "timeoutMs" | "stdin"
>;

const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

const buildCommandWithStdin = (
  command: string,
  args: string[],
  stdin: string | Uint8Array,
): string => {
  const baseCommand = buildCommand(command, args);
  const payload = typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin);
  const base64 = payload.toString("base64");

  return `printf '%s' '${base64}' | base64 -d | ${baseCommand}`;
};

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

export class E2BProvider implements SandboxProvider<
  E2BSandboxClient,
  typeof E2BSandboxClient,
  E2BExecOptions
> {
  private template?: string;
  private createOptions?: SandboxOpts;
  private connectOptions?: SandboxConnectOpts;
  private allowPublicTraffic?: boolean;

  native: typeof E2BSandboxClient;

  constructor(options: E2BProviderOptions = {}) {
    if (options.template !== undefined) {
      this.template = options.template;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
    if (options.connectOptions !== undefined) {
      this.connectOptions = options.connectOptions;
    }
    if (options.allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = options.allowPublicTraffic;
    }
    this.native = E2BSandboxClient;
  }

  async create(options?: CreateOptions): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    let createOptions = this.createOptions ? { ...this.createOptions } : undefined;
    if (this.allowPublicTraffic !== undefined) {
      const network = createOptions?.network
        ? { ...createOptions.network, allowPublicTraffic: this.allowPublicTraffic }
        : { allowPublicTraffic: this.allowPublicTraffic };
      createOptions = createOptions ? { ...createOptions, network } : { network };
    }
    if (options?.name) {
      const metadata = createOptions?.metadata
        ? { ...createOptions.metadata, name: options.name }
        : { name: options.name };
      createOptions = createOptions ? { ...createOptions, metadata } : { metadata };
    }

    let sandbox: E2BSandboxClient;
    if (this.template) {
      sandbox =
        createOptions === undefined
          ? await E2BSandboxClient.create(this.template)
          : await E2BSandboxClient.create(this.template, createOptions);
    } else if (createOptions) {
      sandbox = await E2BSandboxClient.create(createOptions);
    } else {
      sandbox = await E2BSandboxClient.create();
    }

    return new E2BSandbox(sandbox, options?.name, this.allowPublicTraffic);
  }

  async get(idOrName: string): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    return new E2BSandbox(sandbox);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    await sandbox.kill();
  }
}

class E2BSandbox implements Sandbox<E2BSandboxClient, E2BExecOptions> {
  id: SandboxId;
  name?: string;
  native: E2BSandboxClient;

  private sandbox: E2BSandboxClient;
  private allowPublicTraffic?: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: E2BSandboxClient, name?: string, allowPublicTraffic?: boolean) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    if (allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = allowPublicTraffic;
    }
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("E2BProvider.exec does not support stdin; use native for streaming.");
    }

    const commandString = buildCommand(command, args);
    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const result = await this.sandbox.commands.run(commandString, providerOptions);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecStream> {
    const providerOnStdout = options?.providerOptions?.onStdout;
    const providerOnStderr = options?.providerOptions?.onStderr;

    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const commandString =
      options?.stdin !== undefined
        ? buildCommandWithStdin(command, args, options.stdin)
        : buildCommand(command, args);

    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
      onStdout: (data) => {
        stdoutStream.enqueue(data);
        if (providerOnStdout) {
          void providerOnStdout(data);
        }
      },
      onStderr: (data) => {
        stderrStream.enqueue(data);
        if (providerOnStderr) {
          void providerOnStderr(data);
        }
      },
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const resultPromise = this.sandbox.commands.run(commandString, providerOptions);

    resultPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode: resultPromise.then((result) => result.exitCode ?? null),
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const token = this.sandbox.trafficAccessToken;
    const resolvedVisibility =
      options.visibility ??
      (this.allowPublicTraffic === false
        ? "private"
        : this.allowPublicTraffic === true
          ? "public"
          : token
            ? "private"
            : "public");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (this.allowPublicTraffic === undefined && options.visibility !== undefined) {
      if (options.visibility === "public" && token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "public" URL, but the sandbox requires private access (traffic access token is present). Recreate the sandbox with allowPublicTraffic=true or request a private URL.',
        );
      }
      if (options.visibility === "private" && !token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "private" URL, but the sandbox is configured for public traffic (no access token). Recreate the sandbox with allowPublicTraffic=false or request a public URL.',
        );
      }
    }

    if (this.allowPublicTraffic === false && resolvedVisibility === "public") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox was created with allowPublicTraffic=false. Create a new sandbox with allowPublicTraffic=true to enable public URLs.',
      );
    }
    if (this.allowPublicTraffic === true && resolvedVisibility === "private") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox was created with allowPublicTraffic=true. Create a new sandbox with allowPublicTraffic=false to require private access.',
      );
    }

    const url = `https://${this.sandbox.getHost(options.port)}`;
    let result: ServiceUrl;

    if (resolvedVisibility === "private") {
      if (!token) {
        throw new ServiceUrlError(
          "service_not_ready",
          "Sandbox traffic access token is not available yet.",
        );
      }
      result = {
        url,
        headers: { "e2b-traffic-access-token": token },
        visibility: "private",
      };
    } else {
      result = {
        url,
        visibility: "public",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }
}
