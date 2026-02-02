export type SandboxId = string;

export interface CreateOptions {
  name?: string;
  image?: ImageRef;
}

export interface ListOptions {
  prefix?: string;
}

export type ImageRef = {
  provider: string;
  kind: "registry" | "built" | "template" | "snapshot";
  id: string;
  metadata?: Record<string, string>;
};

export type ImageBuildSpec = {
  name?: string;
  contextPath?: string;
  dockerfilePath?: string;
  dockerfileContent?: string;
  dockerfileCommands?: string[];
  baseImage?: string;
  buildArgs?: Record<string, string>;
  target?: string;
  platform?: string;
  tags?: string[];
};

export type ImageRegistrySpec = {
  ref: string;
  name?: string;
};

export interface ImageBuilder {
  build(spec: ImageBuildSpec): Promise<ImageRef>;
  fromRegistry(spec: ImageRegistrySpec): Promise<ImageRef>;
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
  images?: ImageBuilder;
  native?: TProviderNative;
}

export interface ImageCapableProvider<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> extends SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions> {
  images: ImageBuilder;
}
