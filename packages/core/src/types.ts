export type SandboxId = string;

export interface CreateOptions {
  name?: string;
  image?: ImageRef;
  mounts?: MountSpec[];
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

export type ExecCommandSpec = {
  command: string;
  args?: string[];
};

export type VolumeHandle<TNative = unknown> = {
  id: string;
  name?: string;
  native?: TNative;
};

export type BucketHandle<TNative = unknown> = {
  provider: "s3" | "r2" | "gcs";
  bucket: string;
  name?: string;
  credentialsRef?: string;
  endpointUrl?: string;
  native?: TNative;
};

export type VolumeManager<TNative = unknown> = {
  get(idOrName: string): Promise<VolumeHandle<TNative>>;
  create?: (options: { name: string }) => Promise<VolumeHandle<TNative>>;
  delete?: (idOrName: string) => Promise<void>;
};

export type BucketManager<TNative = unknown> = {
  fromRef: (options: {
    provider: "s3" | "r2" | "gcs";
    bucket: string;
    name?: string;
    credentialsRef?: string;
    endpointUrl?: string;
  }) => Promise<BucketHandle<TNative>>;
};

export type NativeVolumeMount = {
  type: "volume";
  id: string;
  name?: string;
  mountPath: string;
  readOnly?: boolean;
  subpath?: string;
};

export type CloudBucketMount = {
  type: "bucket";
  provider: "s3" | "r2" | "gcs";
  bucket: string;
  mountPath: string;
  prefix?: string;
  readOnly?: boolean;
  credentialsRef?: string;
  endpointUrl?: string;
  forcePathStyle?: boolean;
  requesterPays?: boolean;
};

export type VolumeHandleMount = {
  handle: VolumeHandle;
  mountPath: string;
  readOnly?: boolean;
  subpath?: string;
};

export type BucketHandleMount = {
  handle: BucketHandle;
  mountPath: string;
  readOnly?: boolean;
  prefix?: string;
  requesterPays?: boolean;
};

export type EmulatedMount = {
  type: "emulated";
  mode: "bucket";
  provider: "s3" | "r2" | "gcs";
  tool: "s3fs" | "rclone" | "gcsfuse";
  mountPath: string;
  readOnly?: boolean;
  command: ExecCommandSpec;
  setup?: ExecCommandSpec[];
};

export type MountSpec =
  | NativeVolumeMount
  | CloudBucketMount
  | VolumeHandleMount
  | BucketHandleMount
  | EmulatedMount;

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
  volumes?: VolumeManager;
  buckets?: BucketManager;
  native?: TProviderNative;
}

export interface ImageCapableProvider<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> extends SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions> {
  images: ImageBuilder;
}
