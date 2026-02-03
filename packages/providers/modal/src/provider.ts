import {
  App,
  CloudBucketMount,
  Image,
  ModalClient,
  Sandbox as ModalSandboxClient,
  Secret,
} from "modal";
import type { SandboxCreateParams } from "modal";
import type {
  BucketHandle,
  BucketHandleMount,
  CloudBucketMount as CloudBucketMountSpec,
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
  BucketManager,
} from "@usbx/core";

import type { ModalExecOptions, ModalProviderOptions } from "./types.js";
import { ModalSandbox } from "./sandbox.js";

export class ModalProvider implements ImageCapableProvider<
  ModalSandboxClient,
  App | undefined,
  ModalExecOptions
> {
  private static providerId = "modal";
  private app?: App;
  private appName?: string;
  private appLookupOptions?: ModalProviderOptions["appLookupOptions"];
  private image?: Image;
  private imageRef?: string;
  private imageRegistrySecret?: Secret;
  private sandboxOptions?: SandboxCreateParams;
  private client: ModalClient;

  native?: App;
  images: ImageBuilder;
  volumes: VolumeManager;
  buckets: BucketManager;

  constructor(options: ModalProviderOptions = {}) {
    this.client = options.client ?? new ModalClient();
    if (options.app !== undefined) {
      this.app = options.app;
      this.native = options.app;
    }
    if (options.appName !== undefined) {
      this.appName = options.appName;
    }
    if (options.appLookupOptions !== undefined) {
      this.appLookupOptions = options.appLookupOptions;
    }
    if (options.image !== undefined) {
      this.image = options.image;
    }
    if (options.imageRef !== undefined) {
      this.imageRef = options.imageRef;
    }
    if (options.imageRegistrySecret !== undefined) {
      this.imageRegistrySecret = options.imageRegistrySecret;
    }
    if (options.sandboxOptions !== undefined) {
      this.sandboxOptions = options.sandboxOptions;
    }

    this.images = {
      build: async (spec: ImageBuildSpec): Promise<ImageRef> => {
        const app = await this.resolveApp();
        const baseImage = spec.baseImage ?? this.imageRef;
        if (!baseImage) {
          throw new Error("Modal image build requires baseImage or ModalProviderOptions.imageRef.");
        }

        const commands = this.resolveDockerfileCommands(spec);
        let image = await app.imageFromRegistry(baseImage, this.imageRegistrySecret);
        if (commands.length) {
          image = image.dockerfileCommands(commands);
        }

        const built = await image.build(app);
        return {
          provider: ModalProvider.providerId,
          kind: "built",
          id: built.imageId,
        };
      },
      fromRegistry: async (spec: ImageRegistrySpec): Promise<ImageRef> => {
        return {
          provider: ModalProvider.providerId,
          kind: "registry",
          id: spec.ref,
        };
      },
    };

    this.volumes = {
      get: async (idOrName: string): Promise<VolumeHandle> => {
        const volume = await this.client.volumes.fromName(idOrName);
        return {
          id: volume.volumeId ?? idOrName,
          name: volume.name ?? idOrName,
          native: volume,
        };
      },
      create: async ({ name }: { name: string }): Promise<VolumeHandle> => {
        const volume = await this.client.volumes.fromName(name, { createIfMissing: true });
        return {
          id: volume.volumeId ?? name,
          name: volume.name ?? name,
          native: volume,
        };
      },
      delete: async (idOrName: string): Promise<void> => {
        await this.client.volumes.delete(idOrName);
      },
    };

    this.buckets = {
      fromRef: async (options): Promise<BucketHandle> => ({
        provider: options.provider,
        bucket: options.bucket,
        ...(options.name ? { name: options.name } : {}),
        ...(options.credentialsRef ? { credentialsRef: options.credentialsRef } : {}),
        ...(options.endpointUrl ? { endpointUrl: options.endpointUrl } : {}),
      }),
    };
  }

  async create(options?: CreateOptions): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const app = await this.resolveApp();
    const image = await this.resolveImage(app, options?.image);
    const sandboxOptions = await this.buildSandboxOptions(options?.mounts);
    const sandbox = await app.createSandbox(image, sandboxOptions);
    return new ModalSandbox(sandbox, options?.name);
  }

  async get(idOrName: string): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    return new ModalSandbox(sandbox, undefined);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    await sandbox.terminate();
  }

  private async resolveApp(): Promise<App> {
    if (this.app) {
      return this.app;
    }
    if (!this.appName) {
      throw new Error("ModalProvider requires app or appName.");
    }
    const app = await App.lookup(this.appName, {
      createIfMissing: this.appLookupOptions?.createIfMissing ?? true,
      ...(this.appLookupOptions?.environment !== undefined
        ? { environment: this.appLookupOptions.environment }
        : {}),
    });
    this.app = app;
    this.native = app;
    return app;
  }

  private async resolveImage(app: App, imageRef?: ImageRef): Promise<Image> {
    if (imageRef) {
      if (imageRef.provider !== ModalProvider.providerId) {
        throw new Error(
          `ModalProvider.create cannot use image from provider "${imageRef.provider}".`,
        );
      }
      if (imageRef.kind === "registry") {
        return app.imageFromRegistry(imageRef.id, this.imageRegistrySecret);
      }
      if (imageRef.kind === "built") {
        return Image.fromId(imageRef.id);
      }
      throw new Error(`ModalProvider.create does not support image kind "${imageRef.kind}".`);
    }
    if (this.image) {
      return this.image;
    }
    if (!this.imageRef) {
      throw new Error("ModalProvider requires image or imageRef.");
    }
    const image = await app.imageFromRegistry(this.imageRef, this.imageRegistrySecret);
    this.image = image;
    return image;
  }

  private resolveDockerfileCommands(spec: ImageBuildSpec): string[] {
    if (spec.dockerfileCommands && spec.dockerfileCommands.length) {
      return spec.dockerfileCommands;
    }
    if (spec.dockerfileContent) {
      return this.parseDockerfileCommands(spec.dockerfileContent);
    }
    if (spec.dockerfilePath) {
      throw new Error("Modal image build does not support dockerfilePath.");
    }
    return [];
  }

  private parseDockerfileCommands(content: string): string[] {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 && !line.startsWith("#") && !line.toUpperCase().startsWith("FROM "),
      );
  }

  private async buildSandboxOptions(
    mounts?: MountSpec[],
  ): Promise<SandboxCreateParams | undefined> {
    if (!mounts || mounts.length === 0) {
      return this.sandboxOptions;
    }

    const { volumes, cloudBucketMounts } = await buildModalMounts(this.client, mounts);
    const options: SandboxCreateParams = this.sandboxOptions ? { ...this.sandboxOptions } : {};
    options.volumes = options.volumes ? { ...options.volumes, ...volumes } : volumes;
    options.cloudBucketMounts = options.cloudBucketMounts
      ? { ...options.cloudBucketMounts, ...cloudBucketMounts }
      : cloudBucketMounts;
    return options;
  }
}

const isNativeVolumeMount = (mount: MountSpec): mount is NativeVolumeMount =>
  "type" in mount && mount.type === "volume";

const isHandleMount = (mount: MountSpec): mount is VolumeHandleMount | BucketHandleMount =>
  "handle" in mount;

const isBucketHandle = (handle: VolumeHandle | BucketHandle): handle is BucketHandle =>
  "provider" in handle;

const isBucketHandleMount = (
  mount: VolumeHandleMount | BucketHandleMount,
): mount is BucketHandleMount => "provider" in mount.handle;

const isVolumeHandleMount = (
  mount: VolumeHandleMount | BucketHandleMount,
): mount is VolumeHandleMount => !("provider" in mount.handle);

const normalizeModalMount = (mount: MountSpec): NativeVolumeMount | CloudBucketMountSpec => {
  if (isHandleMount(mount)) {
    if (isBucketHandle(mount.handle)) {
      return {
        type: "bucket",
        provider: mount.handle.provider,
        bucket: mount.handle.bucket,
        mountPath: mount.mountPath,
        ...(isBucketHandleMount(mount) && mount.prefix ? { prefix: mount.prefix } : {}),
        ...(mount.readOnly !== undefined ? { readOnly: mount.readOnly } : {}),
        ...(mount.handle.credentialsRef ? { credentialsRef: mount.handle.credentialsRef } : {}),
        ...(mount.handle.endpointUrl ? { endpointUrl: mount.handle.endpointUrl } : {}),
        ...(isBucketHandleMount(mount) && mount.requesterPays !== undefined
          ? { requesterPays: mount.requesterPays }
          : {}),
      };
    }
    return {
      type: "volume",
      id: mount.handle.name ?? mount.handle.id,
      ...(mount.handle.name ? { name: mount.handle.name } : {}),
      mountPath: mount.mountPath,
      ...(mount.readOnly !== undefined ? { readOnly: mount.readOnly } : {}),
      ...(isVolumeHandleMount(mount) && mount.subpath ? { subpath: mount.subpath } : {}),
    };
  }
  if (mount.type !== "volume" && mount.type !== "bucket") {
    throw new Error("Modal supports only native volume and bucket mounts.");
  }
  return mount;
};

const buildModalMounts = async (
  client: ModalClient,
  mounts: MountSpec[],
): Promise<{
  volumes: Required<SandboxCreateParams>["volumes"];
  cloudBucketMounts: Required<SandboxCreateParams>["cloudBucketMounts"];
}> => {
  const normalizedMounts = mounts.map(normalizeModalMount);

  const volumes: Required<SandboxCreateParams>["volumes"] = {};
  const cloudBucketMounts: Required<SandboxCreateParams>["cloudBucketMounts"] = {};

  for (const mount of normalizedMounts) {
    if (isNativeVolumeMount(mount)) {
      if (mount.subpath) {
        throw new Error("Modal volume mounts do not support subpath.");
      }
      const volume = await client.volumes.fromName(mount.id);
      volumes[mount.mountPath] = mount.readOnly ? volume.readOnly() : volume;
      continue;
    }

    if (mount.forcePathStyle !== undefined) {
      throw new Error("Modal bucket mounts do not support forcePathStyle.");
    }

    const secret = mount.credentialsRef
      ? await client.secrets.fromName(mount.credentialsRef)
      : undefined;
    const mountOptions: {
      secret?: Secret;
      readOnly?: boolean;
      requesterPays?: boolean;
      bucketEndpointUrl?: string;
      keyPrefix?: string;
    } = {
      ...(mount.prefix !== undefined ? { keyPrefix: mount.prefix } : {}),
      ...(mount.readOnly !== undefined ? { readOnly: mount.readOnly } : {}),
      ...(secret ? { secret } : {}),
      ...(mount.endpointUrl !== undefined ? { bucketEndpointUrl: mount.endpointUrl } : {}),
      ...(mount.requesterPays !== undefined ? { requesterPays: mount.requesterPays } : {}),
    };
    cloudBucketMounts[mount.mountPath] = new CloudBucketMount(mount.bucket, mountOptions);
  }

  return { volumes, cloudBucketMounts };
};
