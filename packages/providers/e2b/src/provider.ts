import { Sandbox as E2BSandboxClient } from "e2b";
import type { SandboxConnectOpts, SandboxOpts } from "e2b";
import type { CreateOptions, Sandbox, SandboxProvider } from "@usbx/core";

import type { E2BExecOptions, E2BProviderOptions } from "./types.js";
import { E2BSandbox } from "./sandbox.js";

export class E2BProvider implements SandboxProvider<
  E2BSandboxClient,
  typeof E2BSandboxClient,
  E2BExecOptions
> {
  private template?: string;
  private createOptions?: SandboxOpts;
  private connectOptions?: SandboxConnectOpts;
  private allowPublicTraffic?: boolean;

  native: typeof E2BSandboxClient;

  constructor(options: E2BProviderOptions = {}) {
    if (options.template !== undefined) {
      this.template = options.template;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
    if (options.connectOptions !== undefined) {
      this.connectOptions = options.connectOptions;
    }
    if (options.allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = options.allowPublicTraffic;
    }
    this.native = E2BSandboxClient;
  }

  async create(options?: CreateOptions): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    let createOptions = this.createOptions ? { ...this.createOptions } : undefined;
    if (this.allowPublicTraffic !== undefined) {
      const network = createOptions?.network
        ? { ...createOptions.network, allowPublicTraffic: this.allowPublicTraffic }
        : { allowPublicTraffic: this.allowPublicTraffic };
      createOptions = createOptions ? { ...createOptions, network } : { network };
    }
    if (options?.name) {
      const metadata = createOptions?.metadata
        ? { ...createOptions.metadata, name: options.name }
        : { name: options.name };
      createOptions = createOptions ? { ...createOptions, metadata } : { metadata };
    }

    let sandbox: E2BSandboxClient;
    if (this.template) {
      sandbox =
        createOptions === undefined
          ? await E2BSandboxClient.create(this.template)
          : await E2BSandboxClient.create(this.template, createOptions);
    } else if (createOptions) {
      sandbox = await E2BSandboxClient.create(createOptions);
    } else {
      sandbox = await E2BSandboxClient.create();
    }

    return new E2BSandbox(sandbox, options?.name, this.allowPublicTraffic);
  }

  async get(idOrName: string): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    return new E2BSandbox(sandbox);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    await sandbox.kill();
  }
}
