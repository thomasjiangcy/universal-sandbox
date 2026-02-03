import { randomUUID } from "node:crypto";
import path from "node:path";
import Docker from "dockerode";
import * as tar from "tar-fs";
import type {
  BucketHandle,
  BucketHandleMount,
  CreateOptions,
  EmulatedMount,
  ExecCommandSpec,
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

import type {
  LocalDockerExecOptions,
  LocalDockerPortExposure,
  LocalDockerProviderOptions,
} from "./types.js";
import { buildPortExposureConfig, resolvePortExposure } from "./internal/ports.js";
import { LocalDockerSandbox } from "./sandbox.js";

const LOCAL_DOCKER_PROVIDER_ID = "local-docker";

const resolveTag = (spec: ImageBuildSpec): string => {
  if (spec.tags && spec.tags.length > 1) {
    throw new Error("LocalDocker image build supports at most one tag.");
  }
  if (spec.tags && spec.tags.length === 1) {
    const [tag] = spec.tags;
    if (!tag) {
      throw new Error("LocalDocker image build requires a tag value.");
    }
    return tag;
  }
  if (spec.name) {
    return spec.name;
  }
  return `usbx-${randomUUID()}`;
};

export class LocalDockerProvider implements ImageCapableProvider<
  Docker.Container,
  Docker,
  LocalDockerExecOptions
> {
  private client: Docker;
  private defaultImage?: string;
  private defaultCommand: string[];
  private portExposure: Required<LocalDockerPortExposure>;
  private hostConfig?: Docker.ContainerCreateOptions["HostConfig"];

  native: Docker;
  images: ImageBuilder;
  volumes: VolumeManager;

  constructor(options: LocalDockerProviderOptions = {}) {
    if (options.docker) {
      this.client = options.docker;
    } else {
      const config: Docker.DockerOptions = {};
      if (options.socketPath) {
        config.socketPath = options.socketPath;
      }
      if (options.host) {
        config.host = options.host;
      }
      if (options.port) {
        config.port = options.port;
      }
      if (options.protocol) {
        config.protocol = options.protocol;
      }

      this.client = Object.keys(config).length ? new Docker(config) : new Docker();
    }

    this.native = this.client;
    if (options.defaultImage !== undefined) {
      this.defaultImage = options.defaultImage;
    }
    this.defaultCommand = options.defaultCommand ?? ["sleep", "infinity"];
    this.portExposure = resolvePortExposure(options.portExposure);
    if (options.hostConfig !== undefined) {
      this.hostConfig = options.hostConfig;
    }

    this.images = {
      build: async (spec: ImageBuildSpec): Promise<ImageRef> => {
        if (!spec.contextPath) {
          throw new Error("LocalDocker image build requires contextPath.");
        }
        if (spec.dockerfileContent) {
          throw new Error("LocalDocker image build does not support dockerfileContent.");
        }
        if (spec.dockerfileCommands && spec.dockerfileCommands.length > 0) {
          throw new Error("LocalDocker image build does not support dockerfileCommands.");
        }

        const contextPath = path.resolve(spec.contextPath);
        const dockerfilePath = spec.dockerfilePath ?? "Dockerfile";
        const resolvedDockerfile = path.resolve(contextPath, dockerfilePath);
        const dockerfileRelative = path.relative(contextPath, resolvedDockerfile);
        if (dockerfileRelative.startsWith("..")) {
          throw new Error("LocalDocker dockerfilePath must be within contextPath.");
        }

        const tag = resolveTag(spec);
        const buildOptions: Docker.ImageBuildOptions = {
          dockerfile: dockerfileRelative,
          t: tag,
          ...(spec.buildArgs ? { buildargs: spec.buildArgs } : {}),
          ...(spec.target ? { target: spec.target } : {}),
          ...(spec.platform ? { platform: spec.platform } : {}),
        };

        const tarStream = tar.pack(contextPath);
        const stream = await this.client.buildImage(tarStream, buildOptions);
        await new Promise<void>((resolve, reject) => {
          this.client.modem.followProgress(stream, (error: Error | null) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });

        return {
          provider: LOCAL_DOCKER_PROVIDER_ID,
          kind: "built",
          id: tag,
        };
      },
      fromRegistry: async (spec: ImageRegistrySpec): Promise<ImageRef> => {
        await this.ensureImage(spec.ref);
        return {
          provider: LOCAL_DOCKER_PROVIDER_ID,
          kind: "registry",
          id: spec.ref,
        };
      },
    };

    this.volumes = {
      get: async (idOrName: string): Promise<VolumeHandle> => {
        const volume = this.client.getVolume(idOrName);
        const info = await volume.inspect();
        return {
          id: info.Name,
          name: info.Name,
          native: volume,
        };
      },
      create: async ({ name }: { name: string }): Promise<VolumeHandle> => {
        const created = await this.client.createVolume({ Name: name });
        const volumeName = created.Name ?? name;
        const volume = this.client.getVolume(volumeName);
        return {
          id: volumeName,
          name: volumeName,
          native: volume,
        };
      },
      delete: async (idOrName: string): Promise<void> => {
        const volume = this.client.getVolume(idOrName);
        await volume.remove();
      },
    };
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<Docker.Container, LocalDockerExecOptions>> {
    if (!options?.name) {
      throw new Error("LocalDockerProvider.create requires a name.");
    }

    const imageRef = options?.image;
    if (imageRef && imageRef.provider !== LOCAL_DOCKER_PROVIDER_ID) {
      throw new Error(
        `LocalDockerProvider.create cannot use image from provider "${imageRef.provider}".`,
      );
    }

    const image = imageRef?.id ?? this.defaultImage;
    if (!image) {
      throw new Error(
        "LocalDockerProvider requires defaultImage or CreateOptions.image to create containers.",
      );
    }

    await this.ensureImage(image);

    const { ExposedPorts, HostConfig } = buildPortExposureConfig(this.portExposure);
    const mountConfig = options?.mounts ? resolveDockerMounts(options.mounts) : undefined;
    const mounts = mountConfig?.native ?? [];
    const hostConfigBase: Docker.ContainerCreateOptions["HostConfig"] = {
      ...HostConfig,
      ...this.hostConfig,
    };
    const existingMounts = hostConfigBase.Mounts ?? [];
    const mergedHostConfig =
      mounts.length > 0
        ? {
            ...hostConfigBase,
            Mounts: [...existingMounts, ...mounts],
          }
        : HostConfig;
    const container = await this.client.createContainer({
      name: options.name,
      Image: image,
      Cmd: this.defaultCommand,
      Tty: false,
      ...(ExposedPorts ? { ExposedPorts } : {}),
      ...(mergedHostConfig ? { HostConfig: mergedHostConfig } : {}),
    });

    await container.start();
    const sandbox = new LocalDockerSandbox(container.id, options.name, container, this.client);
    if (mountConfig?.emulated && mountConfig.emulated.length > 0) {
      await applyEmulatedMounts("Local Docker", sandbox, mountConfig.emulated);
    }
    return sandbox;
  }

  async get(idOrName: string): Promise<Sandbox<Docker.Container, LocalDockerExecOptions>> {
    const container = this.client.getContainer(idOrName);
    const info = await container.inspect();
    const name = info.Name?.replace(/^\//, "") || idOrName;
    return new LocalDockerSandbox(info.Id, name, container, this.client);
  }

  async delete(idOrName: string): Promise<void> {
    const container = this.client.getContainer(idOrName);
    await container.remove({ force: true });
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.client.getImage(image).inspect();
      return;
    } catch {
      const stream = await this.client.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.client.modem.followProgress(stream, (error: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
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

const normalizeDockerMount = (mount: MountSpec): NativeVolumeMount => {
  if (isHandleMount(mount)) {
    if (isBucketHandle(mount.handle)) {
      throw new Error("Local Docker supports only native volume mounts.");
    }
    if (isVolumeHandleMount(mount) && mount.subpath) {
      throw new Error("Local Docker volume mounts do not support subpath.");
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
    throw new Error("Local Docker supports only native volume mounts.");
  }
  if (mount.subpath) {
    throw new Error("Local Docker volume mounts do not support subpath.");
  }
  return mount;
};

const buildDockerVolumeMounts = (
  mounts: MountSpec[],
): NonNullable<NonNullable<Docker.ContainerCreateOptions["HostConfig"]>["Mounts"]> => {
  const volumeMounts = mounts.map(normalizeDockerMount);

  return volumeMounts.map((mount) => ({
    Type: "volume",
    Source: mount.id,
    Target: mount.mountPath,
    ReadOnly: mount.readOnly ?? false,
  }));
};

const isEmulatedMount = (mount: MountSpec): mount is EmulatedMount =>
  "type" in mount && mount.type === "emulated";

const resolveDockerMounts = (
  mounts: MountSpec[],
): {
  native: NonNullable<NonNullable<Docker.ContainerCreateOptions["HostConfig"]>["Mounts"]>;
  emulated: EmulatedMount[];
} => {
  const emulated = mounts.filter(isEmulatedMount);
  const native = mounts.filter((mount) => !isEmulatedMount(mount));
  if (native.length === 0) {
    return { native: [], emulated };
  }
  return { native: buildDockerVolumeMounts(native), emulated };
};

const runCommand = async (
  providerName: string,
  sandbox: Sandbox<Docker.Container, LocalDockerExecOptions>,
  spec: ExecCommandSpec,
  label: string,
): Promise<void> => {
  try {
    const result = await sandbox.exec(spec.command, spec.args ?? []);
    if (result.exitCode !== 0) {
      const exitCode = result.exitCode ?? "unknown";
      throw new Error(
        `${providerName} emulated mount ${label} failed (exit ${exitCode}): ${result.stderr}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${providerName} emulated mount ${label} failed: ${message}`);
  }
};

const buildEmulatedCommand = (mount: EmulatedMount): ExecCommandSpec => {
  const args = mount.command.args ? [...mount.command.args] : [];
  if (mount.readOnly) {
    if (mount.tool === "s3fs") {
      if (!hasS3fsReadOnly(args)) {
        args.push("-o", "ro");
      }
    } else if (mount.tool === "rclone" || mount.tool === "gcsfuse") {
      if (!args.includes("--read-only")) {
        args.push("--read-only");
      }
    }
  }
  return { command: mount.command.command, args };
};

const hasS3fsReadOnly = (args: string[]): boolean => {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "ro" || arg.startsWith("ro,") || arg.endsWith(",ro") || arg.includes(",ro,")) {
      return true;
    }
    if (arg === "-o") {
      const next = args[i + 1];
      if (
        next === "ro" ||
        next?.startsWith("ro,") ||
        next?.endsWith(",ro") ||
        next?.includes(",ro,")
      ) {
        return true;
      }
    }
  }
  return false;
};

const applyEmulatedMounts = async (
  providerName: string,
  sandbox: Sandbox<Docker.Container, LocalDockerExecOptions>,
  mounts: EmulatedMount[],
): Promise<void> => {
  for (const mount of mounts) {
    if (mount.setup) {
      for (const setupCommand of mount.setup) {
        await runCommand(providerName, sandbox, setupCommand, "setup");
      }
    }
    await runCommand(providerName, sandbox, buildEmulatedCommand(mount), "command");
  }
};
