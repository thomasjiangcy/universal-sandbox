import type {
  CreateOptions,
  ImageBuilder,
  ImageCapableProvider,
  Sandbox,
  SandboxProvider,
} from "./types.js";

export type SandboxClientOptions<
  TProvider extends SandboxProvider<unknown, unknown, unknown> = SandboxProvider,
> = {
  provider: TProvider;
};

type ProviderSandbox<TProvider extends SandboxProvider<unknown, unknown, unknown>> =
  TProvider extends { create(options?: CreateOptions): Promise<infer TSandbox> }
    ? TSandbox
    : Sandbox<unknown, unknown>;

type ProviderNative<TProvider extends SandboxProvider<unknown, unknown, unknown>> =
  TProvider extends { native?: infer TProviderNative } ? TProviderNative | undefined : undefined;

export class SandboxClient<
  TProvider extends SandboxProvider<unknown, unknown, unknown> = SandboxProvider,
> {
  protected provider: TProvider;
  images?: ImageBuilder;

  constructor(options: SandboxClientOptions<TProvider>) {
    this.provider = options.provider;
    if (options.provider.images) {
      this.images = options.provider.images;
    }
  }

  get native(): ProviderNative<TProvider> {
    return this.provider.native;
  }

  async create(options?: CreateOptions): Promise<ProviderSandbox<TProvider>> {
    return this.provider.create(options);
  }

  async get(idOrName: string): Promise<ProviderSandbox<TProvider>> {
    return this.provider.get(idOrName);
  }

  async delete(idOrName: string): Promise<void> {
    return this.provider.delete(idOrName);
  }
}

export class SandboxClientWithImages<
  TProvider extends ImageCapableProvider<unknown, unknown, unknown> = ImageCapableProvider,
> extends SandboxClient<TProvider> {
  override images: ImageBuilder;

  constructor(options: SandboxClientOptions<TProvider>) {
    super(options);
    this.images = options.provider.images;
  }
}

const isImageCapableProvider = (
  provider: SandboxProvider<unknown, unknown, unknown>,
): provider is ImageCapableProvider<unknown, unknown, unknown> => provider.images !== undefined;

export function createSandboxClient<
  TProvider extends ImageCapableProvider<unknown, unknown, unknown>,
>(options: SandboxClientOptions<TProvider>): SandboxClientWithImages<TProvider>;
export function createSandboxClient<TProvider extends SandboxProvider<unknown, unknown, unknown>>(
  options: SandboxClientOptions<TProvider>,
): SandboxClient<TProvider>;
export function createSandboxClient(
  options: SandboxClientOptions<SandboxProvider<unknown, unknown, unknown>>,
): SandboxClient<SandboxProvider<unknown, unknown, unknown>> {
  if (isImageCapableProvider(options.provider)) {
    return new SandboxClientWithImages({ provider: options.provider });
  }
  return new SandboxClient(options);
}
