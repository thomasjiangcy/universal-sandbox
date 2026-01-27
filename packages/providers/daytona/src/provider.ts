import { Daytona } from "@daytonaio/sdk";
import type {
  CreateSandboxFromImageParams,
  CreateSandboxFromSnapshotParams,
  Sandbox as DaytonaSandboxClient,
} from "@daytonaio/sdk";
import type { CreateOptions, Sandbox, SandboxProvider } from "@usbx/core";

import type { DaytonaExecOptions, DaytonaProviderOptions } from "./types.js";
import { DaytonaSandbox } from "./sandbox.js";

type DaytonaCreateParams = CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams;

export class DaytonaProvider implements SandboxProvider<
  DaytonaSandboxClient,
  Daytona,
  DaytonaExecOptions
> {
  private client: Daytona;
  private createParams?: DaytonaCreateParams;
  private createOptions?: DaytonaProviderOptions["createOptions"];

  native: Daytona;

  constructor(options: DaytonaProviderOptions = {}) {
    this.client = options.client ?? new Daytona(options.config);
    this.native = this.client;
    if (options.createParams !== undefined) {
      this.createParams = options.createParams;
    }
    if (options.createOptions !== undefined) {
      this.createOptions = options.createOptions;
    }
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
}
