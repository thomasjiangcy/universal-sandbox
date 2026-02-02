import { Daytona, Image } from "@daytonaio/sdk";
import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
import type {
  CreateOptions,
  ImageBuildSpec,
  ImageBuilder,
  ImageRef,
  ImageRegistrySpec,
  Sandbox,
  SandboxProvider,
} from "@usbx/core";

import type { DaytonaExecOptions, DaytonaProviderOptions } from "./types.js";
import { DaytonaSandbox } from "./sandbox.js";

type DaytonaCreateParams = CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;

export class DaytonaProvider implements SandboxProvider<
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
          this.createOptions?.onSnapshotCreateLogs
            ? {
                onLogs: this.createOptions.onSnapshotCreateLogs,
                timeout: this.createOptions.timeout,
              }
            : this.createOptions?.timeout
              ? { timeout: this.createOptions.timeout }
              : undefined,
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
            this.createOptions?.onSnapshotCreateLogs
              ? {
                  onLogs: this.createOptions.onSnapshotCreateLogs,
                  timeout: this.createOptions.timeout,
                }
              : this.createOptions?.timeout
                ? { timeout: this.createOptions.timeout }
                : undefined,
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
    if (options?.image) {
      if (options.image.provider !== DaytonaProvider.providerId) {
        throw new Error(
          `DaytonaProvider.create cannot use image from provider "${options.image.provider}".`,
        );
      }
      if (options.image.kind === "snapshot") {
        const { image: _image, snapshot: _snapshot, ...rest } = createParams ?? {};
        createParams = {
          ...rest,
          snapshot: options.image.id,
        } satisfies CreateSandboxFromSnapshotParams;
      } else {
        const { image: _image, snapshot: _snapshot, ...rest } = createParams ?? {};
        createParams = {
          ...rest,
          image: options.image.id,
        } satisfies CreateSandboxFromImageParams;
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
}
