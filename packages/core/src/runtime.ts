import type {
  CreateOptions,
  ImageBuilder,
  ImageCapableProvider,
  Sandbox,
  SandboxProvider,
} from "./types.js";

export type SandboxClientOptions<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> = {
  provider: SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions>;
};

export class SandboxClient<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> {
  protected provider: SandboxProvider<TSandboxNative, TProviderNative, TProviderOptions>;
  images?: ImageBuilder;

  constructor(options: SandboxClientOptions<TSandboxNative, TProviderNative, TProviderOptions>) {
    this.provider = options.provider;
    if (options.provider.images) {
      this.images = options.provider.images;
    }
  }

  get native(): TProviderNative | undefined {
    return this.provider.native;
  }

  create(options?: CreateOptions): Promise<Sandbox<TSandboxNative, TProviderOptions>> {
    return this.provider.create(options);
  }

  get(idOrName: string): Promise<Sandbox<TSandboxNative, TProviderOptions>> {
    return this.provider.get(idOrName);
  }

  async delete(idOrName: string): Promise<void> {
    return this.provider.delete(idOrName);
  }
}

export class SandboxClientWithImages<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
> extends SandboxClient<TSandboxNative, TProviderNative, TProviderOptions> {
  override images: ImageBuilder;

  constructor(
    options: SandboxClientOptions<TSandboxNative, TProviderNative, TProviderOptions> & {
      provider: ImageCapableProvider<TSandboxNative, TProviderNative, TProviderOptions>;
    },
  ) {
    super(options);
    this.images = options.provider.images;
  }
}

const isImageCapableProvider = (
  provider: SandboxProvider<unknown, unknown, unknown>,
): provider is ImageCapableProvider<unknown, unknown, unknown> => provider.images !== undefined;

export function createSandboxClient<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
>(
  options: SandboxClientOptions<TSandboxNative, TProviderNative, TProviderOptions> & {
    provider: ImageCapableProvider<TSandboxNative, TProviderNative, TProviderOptions>;
  },
): SandboxClientWithImages<TSandboxNative, TProviderNative, TProviderOptions>;
export function createSandboxClient<
  TSandboxNative = unknown,
  TProviderNative = unknown,
  TProviderOptions = unknown,
>(
  options: SandboxClientOptions<TSandboxNative, TProviderNative, TProviderOptions>,
): SandboxClient<TSandboxNative, TProviderNative, TProviderOptions>;
export function createSandboxClient(
  options: SandboxClientOptions,
): SandboxClient | SandboxClientWithImages {
  if (isImageCapableProvider(options.provider)) {
    return new SandboxClientWithImages({ provider: options.provider });
  }
  return new SandboxClient(options);
}
