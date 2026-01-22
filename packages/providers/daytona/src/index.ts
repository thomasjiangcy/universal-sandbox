import { Daytona } from "@daytonaio/sdk";
import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  DaytonaConfig,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxId,
  SandboxProvider,
} from "@usbx/core";

export type DaytonaProviderOptions = {
  client?: Daytona;
  config?: DaytonaConfig;
  createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  createOptions?: {
    timeout?: number;
    onSnapshotCreateLogs?: (chunk: string) => void;
  };
};

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

export class DaytonaProvider implements SandboxProvider<
  DaytonaSandboxClient,
  Daytona,
  DaytonaExecOptions
> {
  private client: Daytona;
  private createParams?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;
  private createOptions?: DaytonaProviderOptions["createOptions"];

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
    return new DaytonaSandbox(sandbox);
  }

  async get(idOrName: string): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    const sandbox = await this.client.get(idOrName);
    return new DaytonaSandbox(sandbox);
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

  constructor(sandbox: DaytonaSandboxClient) {
    this.id = sandbox.id;
    this.name = sandbox.name;
    this.sandbox = sandbox;
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
}
