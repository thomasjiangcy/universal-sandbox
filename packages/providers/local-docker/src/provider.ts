import { randomUUID } from "node:crypto";
import path from "node:path";
import Docker from "dockerode";
import * as tar from "tar-fs";
import type {
  CreateOptions,
  ImageBuildSpec,
  ImageBuilder,
  ImageCapableProvider,
  ImageRef,
  ImageRegistrySpec,
  Sandbox,
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

  native: Docker;
  images: ImageBuilder;

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
    const container = await this.client.createContainer({
      name: options.name,
      Image: image,
      Cmd: this.defaultCommand,
      Tty: false,
      ...(ExposedPorts ? { ExposedPorts } : {}),
      ...(HostConfig ? { HostConfig } : {}),
    });

    await container.start();
    return new LocalDockerSandbox(container.id, options.name, container, this.client);
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
