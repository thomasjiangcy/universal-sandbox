import { Sandbox as E2BSandboxClient, Template } from "e2b";
import type { SandboxConnectOpts, SandboxOpts } from "e2b";
import type {
  CreateOptions,
  ImageBuildSpec,
  ImageBuilder,
  ImageCapableProvider,
  ImageRef,
  ImageRegistrySpec,
  Sandbox,
} from "@usbx/core";

import type { E2BExecOptions, E2BProviderOptions } from "./types.js";
import { E2BSandbox } from "./sandbox.js";

export class E2BProvider implements ImageCapableProvider<
  E2BSandboxClient,
  typeof E2BSandboxClient,
  E2BExecOptions
> {
  private static providerId = "e2b";
  private template?: string;
  private createOptions?: SandboxOpts;
  private connectOptions?: SandboxConnectOpts;
  private allowPublicTraffic?: boolean;

  native: typeof E2BSandboxClient;
  images: ImageBuilder;

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

    this.images = {
      build: async (spec: ImageBuildSpec): Promise<ImageRef> => {
        if (!spec.name) {
          throw new Error("E2B image build requires name for the template alias.");
        }
        const template = this.buildTemplate(spec);
        const buildInfo = await Template.build(template, { alias: spec.name });
        return {
          provider: E2BProvider.providerId,
          kind: "template",
          id: buildInfo.templateId,
          metadata: { alias: buildInfo.alias },
        };
      },
      fromRegistry: async (spec: ImageRegistrySpec): Promise<ImageRef> => {
        if (!spec.name) {
          throw new Error("E2B registry images require name for the template alias.");
        }
        const template = Template().fromImage(spec.ref);
        const buildInfo = await Template.build(template, { alias: spec.name });
        return {
          provider: E2BProvider.providerId,
          kind: "template",
          id: buildInfo.templateId,
          metadata: { alias: buildInfo.alias },
        };
      },
    };
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

    let template = this.template;
    if (options?.image) {
      if (options.image.provider !== E2BProvider.providerId) {
        throw new Error(
          `E2BProvider.create cannot use image from provider "${options.image.provider}".`,
        );
      }
      if (options.image.kind !== "template") {
        throw new Error("E2BProvider.create requires a template image reference.");
      }
      template = options.image.id;
    }

    let sandbox: E2BSandboxClient;
    if (template) {
      sandbox =
        createOptions === undefined
          ? await E2BSandboxClient.create(template)
          : await E2BSandboxClient.create(template, createOptions);
    } else if (createOptions) {
      sandbox = await E2BSandboxClient.create(createOptions);
    } else {
      sandbox = await E2BSandboxClient.create();
    }

    return new E2BSandbox(sandbox, options?.name);
  }

  async get(idOrName: string): Promise<Sandbox<E2BSandboxClient, E2BExecOptions>> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    return new E2BSandbox(sandbox);
  }

  async delete(idOrName: string): Promise<void> {
    const sandbox = await E2BSandboxClient.connect(idOrName, this.connectOptions);
    await sandbox.kill();
  }

  private buildTemplate(spec: ImageBuildSpec) {
    if (spec.dockerfileCommands && spec.dockerfileCommands.length > 0) {
      throw new Error("E2B image build does not support dockerfileCommands.");
    }
    if (spec.dockerfileContent && spec.dockerfilePath) {
      throw new Error("E2B image build cannot use both dockerfileContent and dockerfilePath.");
    }
    if (spec.dockerfileContent) {
      return Template().fromDockerfile(spec.dockerfileContent);
    }
    if (spec.dockerfilePath) {
      return Template().fromDockerfile(spec.dockerfilePath);
    }
    if (spec.baseImage) {
      return Template().fromImage(spec.baseImage);
    }
    throw new Error("E2B image build requires dockerfileContent, dockerfilePath, or baseImage.");
  }
}
