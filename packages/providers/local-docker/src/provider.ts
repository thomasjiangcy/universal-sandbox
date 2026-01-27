import Docker from "dockerode";
import type { CreateOptions, Sandbox, SandboxProvider } from "@usbx/core";

import type {
  LocalDockerExecOptions,
  LocalDockerPortExposure,
  LocalDockerProviderOptions,
} from "./types.js";
import { buildPortExposureConfig, resolvePortExposure } from "./internal/ports.js";
import { LocalDockerSandbox } from "./sandbox.js";

export class LocalDockerProvider implements SandboxProvider<
  Docker.Container,
  Docker,
  LocalDockerExecOptions
> {
  private client: Docker;
  private defaultImage?: string;
  private defaultCommand: string[];
  private portExposure: Required<LocalDockerPortExposure>;

  native: Docker;

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
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<Docker.Container, LocalDockerExecOptions>> {
    if (!options?.name) {
      throw new Error("LocalDockerProvider.create requires a name.");
    }

    if (!this.defaultImage) {
      throw new Error(
        "LocalDockerProvider requires defaultImage in the constructor to create containers.",
      );
    }

    await this.ensureImage(this.defaultImage);

    const { ExposedPorts, HostConfig } = buildPortExposureConfig(this.portExposure);
    const container = await this.client.createContainer({
      name: options.name,
      Image: this.defaultImage,
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
