import { Daytona, Image } from "@daytonaio/sdk";
import type {
  CreateSandboxBaseParams,
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
import type {
  BucketHandle,
  BucketHandleMount,
  CreateOptions,
  ImageBuildSpec,
  ImageBuilder,
  ImageCapableProvider,
  ImageRef,
  ImageRegistrySpec,
  MountSpec,
  NativeVolumeMount,
  Sandbox,
  VolumeHandle,
  VolumeHandleMount,
  VolumeManager,
} from "@usbx/core";

import type { DaytonaExecOptions, DaytonaProviderOptions } from "./types.js";
import { DaytonaSandbox } from "./sandbox.js";

type DaytonaCreateParams = CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;

export class DaytonaProvider implements ImageCapableProvider<
  DaytonaSandboxClient,
  Daytona,
  DaytonaExecOptions
> {
  private static providerId = "daytona";
  private client: Daytona;
  private createParams?: DaytonaCreateParams;
  private createOptions?: DaytonaProviderOptions["createOptions"];

  native: Daytona;
  images: ImageBuilder;
  volumes: VolumeManager;

  constructor(options: DaytonaProviderOptions = {}) {
    this.client = options.client ?? new Daytona(options.config);
    this.native = this.client;
    if (options.createParams !== undefined) {
      this.createParams = options.createParams;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }

    this.images = {
      build: async (spec: ImageBuildSpec): Promise<ImageRef> => {
        if (!spec.name) {
          throw new Error("Daytona image build requires name for the snapshot.");
        }
        const image = this.buildImage(spec);
        const snapshot = await this.client.snapshot.create(
          { name: spec.name, image },
          this.buildSnapshotOptions(),
        );
        return {
          provider: DaytonaProvider.providerId,
          kind: "snapshot",
          id: snapshot.name,
        };
      },
      fromRegistry: async (spec: ImageRegistrySpec): Promise<ImageRef> => {
        if (spec.name) {
          const snapshot = await this.client.snapshot.create(
            { name: spec.name, image: spec.ref },
            this.buildSnapshotOptions(),
          );
          return {
            provider: DaytonaProvider.providerId,
            kind: "snapshot",
            id: snapshot.name,
          };
        }
        return {
          provider: DaytonaProvider.providerId,
          kind: "registry",
          id: spec.ref,
        };
      },
    };

    this.volumes = {
      get: async (idOrName: string): Promise<VolumeHandle> => {
        const volume = await this.client.volume.get(idOrName);
        return {
          id: volume.id ?? idOrName,
          name: volume.name,
          native: volume,
        };
      },
      create: async ({ name }: { name: string }): Promise<VolumeHandle> => {
        const volume = await this.client.volume.create(name);
        return {
          id: volume.id ?? name,
          name: volume.name,
          native: volume,
        };
      },
      delete: async (idOrName: string): Promise<void> => {
        const volume = await this.client.volume.get(idOrName);
        await this.client.volume.delete(volume);
      },
    };
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<DaytonaSandboxClient, DaytonaExecOptions>> {
    let createParams: DaytonaCreateParams | undefined = this.createParams
      ? { ...this.createParams }
      : undefined;
    if (options?.mounts && options.mounts.length > 0) {
      const volumes = buildDaytonaVolumes(options.mounts);
      const existing = createParams?.volumes ?? [];
      createParams = createParams
        ? { ...createParams, volumes: [...existing, ...volumes] }
        : { volumes };
    }
    if (options?.name) {
      createParams = createParams
        ? { ...createParams, name: options.name }
        : { name: options.name };
    }
    if (options?.image) {
      if (options.image.provider !== DaytonaProvider.providerId) {
        throw new Error(
          `DaytonaProvider.create cannot use image from provider "${options.image.provider}".`,
        );
      }
      const baseParams = this.extractBaseParams(createParams);
      if (options.image.kind === "snapshot") {
        const params: CreateSandboxFromSnapshotParams = {
          ...baseParams,
          snapshot: options.image.id,
        };
        createParams = params;
      } else {
        const params: CreateSandboxFromImageParams = {
          ...baseParams,
          image: options.image.id,
        };
        createParams = params;
      }
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

  private buildImage(spec: ImageBuildSpec): Image {
    if (spec.dockerfileCommands && spec.dockerfileCommands.length > 0) {
      throw new Error("Daytona image build does not support dockerfileCommands.");
    }
    if (spec.dockerfileContent && spec.dockerfilePath) {
      throw new Error("Daytona image build cannot use both dockerfileContent and dockerfilePath.");
    }
    if (spec.dockerfileContent) {
      throw new Error("Daytona image build does not support dockerfileContent.");
    }
    if (spec.dockerfilePath) {
      return Image.fromDockerfile(spec.dockerfilePath);
    }
    if (spec.baseImage) {
      return Image.base(spec.baseImage);
    }
    throw new Error("Daytona image build requires dockerfilePath or baseImage.");
  }

  private extractBaseParams(
    createParams: DaytonaCreateParams | undefined,
  ): CreateSandboxBaseParams {
    if (!createParams) {
      return {};
    }
    const {
      name,
      user,
      language,
      envVars,
      labels,
      public: isPublic,
      autoStopInterval,
      autoArchiveInterval,
      autoDeleteInterval,
      volumes,
      networkBlockAll,
      networkAllowList,
      ephemeral,
    } = createParams;
    return {
      ...(name !== undefined ? { name } : {}),
      ...(user !== undefined ? { user } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(envVars !== undefined ? { envVars } : {}),
      ...(labels !== undefined ? { labels } : {}),
      ...(isPublic !== undefined ? { public: isPublic } : {}),
      ...(autoStopInterval !== undefined ? { autoStopInterval } : {}),
      ...(autoArchiveInterval !== undefined ? { autoArchiveInterval } : {}),
      ...(autoDeleteInterval !== undefined ? { autoDeleteInterval } : {}),
      ...(volumes !== undefined ? { volumes } : {}),
      ...(networkBlockAll !== undefined ? { networkBlockAll } : {}),
      ...(networkAllowList !== undefined ? { networkAllowList } : {}),
      ...(ephemeral !== undefined ? { ephemeral } : {}),
    };
  }

  private buildSnapshotOptions():
    | {
        onLogs?: (chunk: string) => void;
        timeout?: number;
      }
    | undefined {
    if (!this.createOptions) {
      return undefined;
    }
    const options: { onLogs?: (chunk: string) => void; timeout?: number } = {};
    if (this.createOptions.onSnapshotCreateLogs) {
      options.onLogs = this.createOptions.onSnapshotCreateLogs;
    }
    if (this.createOptions.timeout !== undefined) {
      options.timeout = this.createOptions.timeout;
    }
    return Object.keys(options).length > 0 ? options : undefined;
  }
}

const isNativeVolumeMount = (mount: MountSpec): mount is NativeVolumeMount =>
  "type" in mount && mount.type === "volume";

const isHandleMount = (mount: MountSpec): mount is VolumeHandleMount | BucketHandleMount =>
  "handle" in mount;

const isBucketHandle = (handle: VolumeHandle | BucketHandle): handle is BucketHandle =>
  "provider" in handle;

const isVolumeHandleMount = (
  mount: VolumeHandleMount | BucketHandleMount,
): mount is VolumeHandleMount => !("provider" in mount.handle);

const normalizeDaytonaMount = (mount: MountSpec): NativeVolumeMount => {
  if (isHandleMount(mount)) {
    if (isBucketHandle(mount.handle)) {
      throw new Error("Daytona supports only native volume mounts.");
    }
    return {
      type: "volume",
      id: mount.handle.id,
      ...(mount.handle.name ? { name: mount.handle.name } : {}),
      mountPath: mount.mountPath,
      ...(mount.readOnly !== undefined ? { readOnly: mount.readOnly } : {}),
      ...(isVolumeHandleMount(mount) && mount.subpath ? { subpath: mount.subpath } : {}),
    };
  }
  if (!isNativeVolumeMount(mount)) {
    throw new Error("Daytona supports only native volume mounts.");
  }
  return mount;
};

const buildDaytonaVolumes = (
  mounts: MountSpec[],
): NonNullable<CreateSandboxBaseParams["volumes"]> => {
  const volumeMounts = mounts.map(normalizeDaytonaMount);

  return volumeMounts.map((mount) => {
    if (mount.readOnly) {
      throw new Error("Daytona volume mounts do not support readOnly.");
    }
    return {
      volumeId: mount.id,
      mountPath: mount.mountPath,
      ...(mount.subpath ? { subpath: mount.subpath } : {}),
    };
  });
};
