import { SpritesClient } from "@fly/sprites";
import type {
  CreateOptions,
  EmulatedMount,
  ExecCommandSpec,
  MountSpec,
  Sandbox,
  SandboxProvider,
} from "@usbx/core";

import type { SpritesProviderOptions } from "./types.js";
import type { ExecOptions as SpritesExecOptions } from "@fly/sprites";
import { SpritesSandbox } from "./sandbox.js";

export class SpritesProvider implements SandboxProvider<
  ReturnType<SpritesClient["sprite"]>,
  SpritesClient,
  SpritesExecOptions
> {
  private client: SpritesClient;

  native: SpritesClient;

  constructor(options: SpritesProviderOptions) {
    if (options.client) {
      this.client = options.client;
      this.native = options.client;
      return;
    }

    if (!options.token) {
      throw new Error("SpritesProvider requires a token or a client.");
    }

    this.client = new SpritesClient(options.token);
    this.native = this.client;
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>> {
    if (!options?.name) {
      throw new Error("SpritesProvider.create requires a name.");
    }

    await this.client.createSprite(options.name);
    const sandbox = await this.get(options.name);
    if (options?.mounts && options.mounts.length > 0) {
      await applyEmulatedMounts("Sprites", sandbox, options.mounts);
    }
    return sandbox;
  }

  async get(
    idOrName: string,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>> {
    const sprite = this.client.sprite(idOrName);
    return new SpritesSandbox(idOrName, sprite, this.client);
  }

  async delete(idOrName: string): Promise<void> {
    await this.client.deleteSprite(idOrName);
  }
}

const isEmulatedMount = (mount: MountSpec): mount is EmulatedMount =>
  "type" in mount && mount.type === "emulated";

const runCommand = async (
  providerName: string,
  sandbox: Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>,
  spec: ExecCommandSpec,
  label: string,
): Promise<void> => {
  try {
    const result = await sandbox.exec(spec.command, spec.args ?? []);
    if (result.exitCode !== 0) {
      const exitCode = result.exitCode ?? "unknown";
      throw new Error(
        `${providerName} emulated mount ${label} failed (exit ${exitCode}): ${result.stderr}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${providerName} emulated mount ${label} failed: ${message}`);
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
  sandbox: Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>,
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
