export type SandboxId = string;

export interface CreateOptions {
  name?: string;
}

export interface ListOptions {
  prefix?: string;
}

export interface ExecOptions<TProviderOptions = unknown> {
  env?: Record<string, string>;
  cwd?: string;
  stdin?: string | Uint8Array;
  timeoutSeconds?: number;
  providerOptions?: TProviderOptions;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface Sandbox<TNative = unknown, TProviderOptions = unknown> {
  id: SandboxId;
  name?: string;
  exec(
    command: string,
    args?: string[],
    options?: ExecOptions<TProviderOptions>,
  ): Promise<ExecResult>;
  native?: TNative;
}

export interface SandboxProvider<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> {
  create(options?: CreateOptions): Promise<Sandbox<TSandboxNative, TProviderOptions>>;
  get(idOrName: string): Promise<Sandbox<TSandboxNative, TProviderOptions>>;
  native?: TProviderNative;
}
