import { App, Sandbox as ModalSandboxClient } from "modal";
import type { Image, SandboxCreateParams, SandboxExecParams, Secret } from "modal";
import type {
  CreateOptions,
  ExecOptions as UniversalExecOptions,
  ExecResult,
  ExecStream,
  Sandbox,
  SandboxId,
  SandboxProvider,
} from "@usbx/core";
import { readTextOrEmpty } from "./internal.js";

export type ModalProviderOptions = {
  app?: App;
  appName?: string;
  appLookupOptions?: {
    environment?: string;
    createIfMissing?: boolean;
  };
  image?: Image;
  imageRef?: string;
  imageRegistrySecret?: Secret;
  sandboxOptions?: SandboxCreateParams;
};

export type ModalExecOptions = SandboxExecParams;

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
  }

  async create(options?: CreateOptions): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const app = await this.resolveApp();
    const image = await this.resolveImage(app);
    const sandbox = await app.createSandbox(image, this.sandboxOptions);
    return new ModalSandbox(sandbox, options?.name);
  }

  async get(idOrName: string): Promise<Sandbox<ModalSandboxClient, ModalExecOptions>> {
    const sandbox = await ModalSandboxClient.fromId(idOrName);
    return new ModalSandbox(sandbox);
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

class ModalSandbox implements Sandbox<ModalSandboxClient, ModalExecOptions> {
  id: SandboxId;
  name?: string;
  native: ModalSandboxClient;

  private sandbox: ModalSandboxClient;

  constructor(sandbox: ModalSandboxClient, name?: string) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: UniversalExecOptions<ModalExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("ModalProvider.exec does not support stdin.");
    }
    if (options?.env !== undefined) {
      throw new Error("ModalProvider.exec does not support env; use secrets or images instead.");
    }

    const { mode: _mode, ...providerOptions } = options?.providerOptions ?? {};
    const execOptions: SandboxExecParams & { mode?: "text" } = {
      ...providerOptions,
      mode: "text",
      stdout: options?.providerOptions?.stdout ?? "pipe",
      stderr: options?.providerOptions?.stderr ?? "pipe",
    };

    if (options?.cwd !== undefined) {
      execOptions.workdir = options.cwd;
    }
    if (options?.timeoutSeconds !== undefined) {
      execOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const process = await this.sandbox.exec([command, ...args], execOptions);
    const [stdout, stderr, exitCode] = await Promise.all([
      readTextOrEmpty(process.stdout),
      readTextOrEmpty(process.stderr),
      process.wait(),
    ]);

    return {
      stdout,
      stderr,
      exitCode,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: UniversalExecOptions<ModalExecOptions>,
  ): Promise<ExecStream> {
    if (options?.env !== undefined) {
      throw new Error(
        "ModalProvider.execStream does not support env; use secrets or images instead.",
      );
    }

    const { mode: _mode, ...providerOptions } = options?.providerOptions ?? {};
    const execOptions: SandboxExecParams & { mode?: "binary" } = {
      ...providerOptions,
      mode: "binary",
      stdout: options?.providerOptions?.stdout ?? "pipe",
      stderr: options?.providerOptions?.stderr ?? "pipe",
    };

    if (options?.cwd !== undefined) {
      execOptions.workdir = options.cwd;
    }
    if (options?.timeoutSeconds !== undefined) {
      execOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const process = await this.sandbox.exec([command, ...args], execOptions);

    if (options?.stdin !== undefined) {
      await writeToWebStream(process.stdin, options.stdin);
    }

    return {
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
      exitCode: process.wait(),
    };
  }
}

const writeToWebStream = async (
  stream: WritableStream<Uint8Array>,
  input: string | Uint8Array,
): Promise<void> => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const writer = stream.getWriter();
  await writer.write(bytes);
  await writer.close();
  writer.releaseLock();
};
