import type { CreateOptions, Sandbox, SandboxProvider } from "./types.js";

export type SandboxManagerOptions<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> = {
  provider: SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions>;
};

export class SandboxManager<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> {
  private provider: SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions>;

  constructor(options: SandboxManagerOptions<TSandboxNative, TProviderNative, TProviderOptions>) {
    this.provider = options.provider;
  }

  get native(): TProviderNative | undefined {
    return this.provider.native;
  }

  async create(options?: CreateOptions): Promise<Sandbox<TSandboxNative, TProviderOptions>> {
    return this.provider.create(options);
  }

  async get(idOrName: string): Promise<Sandbox<TSandboxNative, TProviderOptions>> {
    return this.provider.get(idOrName);
  }

  async delete(idOrName: string): Promise<void> {
    return this.provider.delete(idOrName);
  }
}
