import { SpritesClient } from "@fly/sprites";
import type { CreateOptions, Sandbox, SandboxProvider } from "@usbx/core";

import type { SpritesProviderOptions } from "./types.js";
import type { ExecOptions as SpritesExecOptions } from "@fly/sprites";
import { SpritesSandbox } from "./sandbox.js";

export class SpritesProvider implements SandboxProvider<
  ReturnType<SpritesClient["sprite"]>,
  SpritesClient,
  SpritesExecOptions
> {
  private client: SpritesClient;
  private token: string | undefined;

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

    this.token = options.token;
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
    return this.get(options.name);
  }

  async get(
    idOrName: string,
  ): Promise<Sandbox<ReturnType<SpritesClient["sprite"]>, SpritesExecOptions>> {
    const sprite = this.client.sprite(idOrName);
    return new SpritesSandbox(idOrName, sprite, this.client, this.token);
  }

  async delete(idOrName: string): Promise<void> {
    await this.client.deleteSprite(idOrName);
  }
}
