import Docker from "dockerode";
import { PassThrough } from "node:stream";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxId,
  SandboxProvider,
} from "@universal/core";

export type DockerProviderOptions = {
  docker?: Docker;
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  defaultImage?: string;
  defaultCommand?: string[];
};

export type DockerExecOptions = {
  user?: string;
  privileged?: boolean;
  tty?: boolean;
};

export class DockerProvider
  implements SandboxProvider<Docker.Container, Docker, DockerExecOptions>
{
  private client: Docker;
  private defaultImage?: string;
  private defaultCommand: string[];

  native: Docker;

  constructor(options: DockerProviderOptions = {}) {
    if (options.docker) {
      this.client = options.docker;
    } else {
      const config: Docker.DockerOptions = {};
      if (options.socketPath) {
        config.socketPath = options.socketPath;
      }
      if (options.host) {
        config.host = options.host;
      }
      if (options.port) {
        config.port = options.port;
      }
      if (options.protocol) {
        config.protocol = options.protocol;
      }

      this.client = Object.keys(config).length ? new Docker(config) : new Docker();
    }

    this.native = this.client;
    if (options.defaultImage !== undefined) {
      this.defaultImage = options.defaultImage;
    }
    this.defaultCommand = options.defaultCommand ?? ["sleep", "infinity"];
  }

  async create(options?: CreateOptions): Promise<Sandbox<Docker.Container, DockerExecOptions>> {
    if (!options?.name) {
      throw new Error("DockerProvider.create requires a name.");
    }

    if (!this.defaultImage) {
      throw new Error(
        "DockerProvider requires defaultImage in the constructor to create containers.",
      );
    }

    await this.ensureImage(this.defaultImage);

    const container = await this.client.createContainer({
      name: options.name,
      Image: this.defaultImage,
      Cmd: this.defaultCommand,
      Tty: false,
    });

    await container.start();
    return new DockerSandbox(container.id, options.name, container, this.client);
  }

  async get(idOrName: string): Promise<Sandbox<Docker.Container, DockerExecOptions>> {
    const container = this.client.getContainer(idOrName);
    const info = await container.inspect();
    const name = info.Name?.replace(/^\//, "") || idOrName;
    return new DockerSandbox(info.Id, name, container, this.client);
  }

  private async ensureImage(image: string): Promise<void> {
    try {
      await this.client.getImage(image).inspect();
      return;
    } catch {
      const stream = await this.client.pull(image);
      await new Promise<void>((resolve, reject) => {
        this.client.modem.followProgress(stream, (error: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }
}

class DockerSandbox implements Sandbox<Docker.Container, DockerExecOptions> {
  id: SandboxId;
  name?: string;
  native: Docker.Container;

  private container: Docker.Container;
  private client: Docker;

  constructor(id: string, name: string | undefined, container: Docker.Container, client: Docker) {
    this.id = id;
    if (name !== undefined) {
      this.name = name;
    }
    this.container = container;
    this.client = client;
    this.native = container;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DockerExecOptions>,
  ): Promise<ExecResult> {
    const inspect = await this.container.inspect();
    if (!inspect.State?.Running) {
      await this.container.start();
    }

    const providerOptions = options?.providerOptions;
    const env = options?.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;

    if (options?.stdin !== undefined) {
      throw new Error("DockerProvider.exec does not support stdin.");
    }

    const isTty = providerOptions?.tty ?? false;

    const exec = await this.container.exec({
      Cmd: [command, ...args],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options?.cwd,
      Env: env,
      Tty: isTty,
      Privileged: providerOptions?.privileged ?? false,
      User: providerOptions?.user,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (isTty) {
      stream.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    } else {
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      stdoutStream.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
      stderrStream.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

      this.client.modem.demuxStream(stream, stdoutStream, stderrStream);
    }

    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("error", (error) => reject(error));
    });

    const execInfo = await exec.inspect();
    return {
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      exitCode: execInfo.ExitCode ?? null,
    };
  }
}
