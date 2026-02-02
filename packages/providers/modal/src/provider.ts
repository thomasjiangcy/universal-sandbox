import { App, Image, Sandbox as ModalSandboxClient } from "modal";
import type { SandboxCreateParams, Secret } from "modal";
import type {
  CreateOptions,
  ImageBuildSpec,
  ImageBuilder,
  ImageCapableProvider,
  ImageRef,
  ImageRegistrySpec,
  Sandbox,
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

  native?: App;
  images: ImageBuilder;

  constructor(options: ModalProviderOptions = {}) {
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
  }

  async create(options?: CreateOptions): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const app = await this.resolveApp();
    const image = await this.resolveImage(app, options?.image);
    const sandbox = await app.createSandbox(image, this.sandboxOptions);
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
}
