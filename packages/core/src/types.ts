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

export interface ExecStream {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin?: WritableStream<Uint8Array>;
  exitCode: Promise<number | null>;
}

export type ServiceUrlVisibility = "public" | "private";

export type ServiceUrl = {
  url: string;
  headers?: Record<string, string>;
  visibility: ServiceUrlVisibility;
};

export type GetServiceUrlOptions = {
  port: number;
  visibility?: ServiceUrlVisibility;
  timeoutSeconds?: number;
};

export type ServiceUrlErrorCode =
  | "visibility_mismatch"
  | "service_not_found"
  | "service_not_ready"
  | "port_unavailable"
  | "tunnel_unavailable"
  | "unsupported";

export class ServiceUrlError extends Error {
  code: ServiceUrlErrorCode;

  constructor(code: ServiceUrlErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Sandbox<TNative = unknown, TProviderOptions = unknown> {
  id: SandboxId;
  name?: string;
  exec(
    command: string,
    args?: string[],
    options?: ExecOptions<TProviderOptions>,
  ): Promise<ExecResult>;
  execStream(
    command: string,
    args?: string[],
    options?: ExecOptions<TProviderOptions>,
  ): Promise<ExecStream>;
  getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl>;
  native?: TNative;
}

export interface SandboxProvider<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> {
  create(options?: CreateOptions): Promise<Sandbox<TSandboxNative, TProviderOptions>>;
  get(idOrName: string): Promise<Sandbox<TSandboxNative, TProviderOptions>>;
  delete(idOrName: string): Promise<void>;
  native?: TProviderNative;
}
