import { App, Sandbox as ModalSandboxClient } from "modal";
import type { Image, SandboxCreateParams, Secret } from "modal";
import type { CreateOptions, Sandbox, SandboxProvider } from "@usbx/core";

import type { ModalExecOptions, ModalProviderOptions } from "./types.js";
import { ensureTcpProxyPorts } from "./internal/tcp-proxy.js";
import { ModalSandbox } from "./sandbox.js";

export class ModalProvider implements SandboxProvider<
  ModalSandboxClient,
  App | undefined,
  ModalExecOptions
> {
  private app?: App;
  private appName?: string;
  private appLookupOptions?: ModalProviderOptions["appLookupOptions"];
  private image?: Image;
  private imageRef?: string;
  private imageRegistrySecret?: Secret;
  private sandboxOptions?: SandboxCreateParams;
  private authMode: ModalProviderOptions["authMode"];

  native?: App;

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
    this.authMode = options.authMode ?? "header";
  }

  async create(options?: CreateOptions): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const app = await this.resolveApp();
    const image = await this.resolveImage(app);
    const sandbox = await app.createSandbox(image, ensureTcpProxyPorts(this.sandboxOptions));
    return new ModalSandbox(sandbox, options?.name, this.authMode);
  }

  async get(idOrName: string): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    return new ModalSandbox(sandbox, undefined, this.authMode);
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

  private async resolveImage(app: App): Promise<Image> {
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
}
