import { Sandbox as E2BSandboxClient, Template } from "e2b";
import type { SandboxConnectOpts, SandboxOpts } from "e2b";
import type {
  CreateOptions,
  EmulatedMount,
  ExecCommandSpec,
  ImageBuildSpec,
  ImageBuilder,
  ImageCapableProvider,
  ImageRef,
  ImageRegistrySpec,
  MountSpec,
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

    const wrapped = new E2BSandbox(sandbox, options?.name);
    if (options?.mounts && options.mounts.length > 0) {
      await applyEmulatedMounts("E2B", wrapped, options.mounts);
    }
    return wrapped;
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

const isEmulatedMount = (mount: MountSpec): mount is EmulatedMount =>
  "type" in mount && mount.type === "emulated";

const runCommand = async (
  providerName: string,
  sandbox: Sandbox<E2BSandboxClient, E2BExecOptions>,
  spec: ExecCommandSpec,
  label: string,
): Promise<void> => {
  const command = `${spec.command} ${(spec.args ?? []).join(" ")}`.trim();
  try {
    const result = await sandbox.exec(spec.command, spec.args ?? []);
    if (result.exitCode !== 0) {
      const exitCode = result.exitCode ?? "unknown";
      const stdout = result.stdout ? `\nstdout:\n${result.stdout}` : "";
      const stderr = result.stderr ? `\nstderr:\n${result.stderr}` : "";
      throw new Error(
        `${providerName} emulated mount ${label} failed (exit ${exitCode}) while running "${command}".${stdout}${stderr}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${providerName} emulated mount ${label} failed while running "${command}": ${message}`,
    );
  }
};

const buildEmulatedCommand = (mount: EmulatedMount): ExecCommandSpec => {
  const args = mount.command.args ? [...mount.command.args] : [];
  if (mount.readOnly) {
    if (mount.tool === "s3fs") {
      if (!hasS3fsReadOnly(args)) {
        args.push("-o", "ro");
      }
    } else if (mount.tool === "rclone" || mount.tool === "gcsfuse") {
      if (!args.includes("--read-only")) {
        args.push("--read-only");
      }
    }
  }
  return { command: mount.command.command, args };
};

const hasS3fsReadOnly = (args: string[]): boolean => {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "ro" || arg.startsWith("ro,") || arg.endsWith(",ro") || arg.includes(",ro,")) {
      return true;
    }
    if (arg === "-o") {
      const next = args[i + 1];
      if (
        next === "ro" ||
        next?.startsWith("ro,") ||
        next?.endsWith(",ro") ||
        next?.includes(",ro,")
      ) {
        return true;
      }
    }
  }
  return false;
};

const applyEmulatedMounts = async (
  providerName: string,
  sandbox: Sandbox<E2BSandboxClient, E2BExecOptions>,
  mounts: MountSpec[],
): Promise<void> => {
  const emulated = mounts.filter(isEmulatedMount);
  if (emulated.length !== mounts.length) {
    throw new Error(`${providerName} supports only emulated mounts via exec for now.`);
  }

  for (const mount of emulated) {
    if (mount.setup) {
      for (const setupCommand of mount.setup) {
        await runCommand(providerName, sandbox, setupCommand, "setup");
      }
    }
    await runCommand(providerName, sandbox, buildEmulatedCommand(mount), "command");
  }
};
