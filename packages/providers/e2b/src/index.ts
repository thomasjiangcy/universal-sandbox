import { Sandbox as E2BSandboxClient } from "e2b";
import type { CommandStartOpts, SandboxConnectOpts, SandboxOpts } from "e2b";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxId,
  SandboxProvider,
} from "@usbx/core";

export type E2BProviderOptions = {
  template?: string;
  createOptions?: SandboxOpts;
  connectOptions?: SandboxConnectOpts;
};

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

export class E2BProvider implements SandboxProvider<
  E2BSandboxClient,
  typeof E2BSandboxClient,
  E2BExecOptions
> {
  private template?: string;
  private createOptions?: SandboxOpts;
  private connectOptions?: SandboxConnectOpts;

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
    this.native = E2BSandboxClient;
  }

  async create(options?: CreateOptions): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    let createOptions = this.createOptions ? { ...this.createOptions } : undefined;
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

    return new E2BSandbox(sandbox, options?.name);
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

  constructor(sandbox: E2BSandboxClient, name?: string) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
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
}
