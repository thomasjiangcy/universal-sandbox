import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { ServiceUrlError } from "@usbx/core";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  Sandbox,
  SandboxId,
  SandboxProvider,
  ServiceUrl,
} from "@usbx/core";

export type LocalDockerPortExposureMode = "published" | "host";

export type LocalDockerPortPublishMode = "same-port" | "random";

export type LocalDockerPortExposure = {
  mode?: LocalDockerPortExposureMode;
  ports?: number[];
  portRange?: { start: number; end: number };
  publishMode?: LocalDockerPortPublishMode;
  hostIp?: string;
};

export type LocalDockerProviderOptions = {
  docker?: Docker;
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
  defaultImage?: string;
  defaultCommand?: string[];
  portExposure?: LocalDockerPortExposure;
};

export type LocalDockerExecOptions = {
  user?: string;
  privileged?: boolean;
  tty?: boolean;
};

export class LocalDockerProvider implements SandboxProvider<
  Docker.Container,
  Docker,
  LocalDockerExecOptions
> {
  private client: Docker;
  private defaultImage?: string;
  private defaultCommand: string[];
  private portExposure: Required<LocalDockerPortExposure>;

  native: Docker;

  constructor(options: LocalDockerProviderOptions = {}) {
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
    this.portExposure = resolvePortExposure(options.portExposure);
  }

  async create(
    options?: CreateOptions,
  ): Promise<Sandbox<Docker.Container, LocalDockerExecOptions>> {
    if (!options?.name) {
      throw new Error("LocalDockerProvider.create requires a name.");
    }

    if (!this.defaultImage) {
      throw new Error(
        "LocalDockerProvider requires defaultImage in the constructor to create containers.",
      );
    }

    await this.ensureImage(this.defaultImage);

    const { ExposedPorts, HostConfig } = buildPortExposureConfig(this.portExposure);
    const container = await this.client.createContainer({
      name: options.name,
      Image: this.defaultImage,
      Cmd: this.defaultCommand,
      Tty: false,
      ...(ExposedPorts ? { ExposedPorts } : {}),
      ...(HostConfig ? { HostConfig } : {}),
    });

    await container.start();
    return new LocalDockerSandbox(container.id, options.name, container, this.client, {
      portExposure: this.portExposure,
    });
  }

  async get(idOrName: string): Promise<Sandbox<Docker.Container, LocalDockerExecOptions>> {
    const container = this.client.getContainer(idOrName);
    const info = await container.inspect();
    const name = info.Name?.replace(/^\//, "") || idOrName;
    return new LocalDockerSandbox(info.Id, name, container, this.client, {
      portExposure: this.portExposure,
    });
  }

  async delete(idOrName: string): Promise<void> {
    const container = this.client.getContainer(idOrName);
    await container.remove({ force: true });
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

class LocalDockerSandbox implements Sandbox<Docker.Container, LocalDockerExecOptions> {
  id: SandboxId;
  name?: string;
  native: Docker.Container;

  private container: Docker.Container;
  private client: Docker;
  private portExposure: Required<LocalDockerPortExposure>;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(
    id: string,
    name: string | undefined,
    container: Docker.Container,
    client: Docker,
    options: {
      portExposure: Required<LocalDockerPortExposure>;
    },
  ) {
    this.id = id;
    if (name !== undefined) {
      this.name = name;
    }
    this.container = container;
    this.client = client;
    this.native = container;
    this.portExposure = options.portExposure;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<LocalDockerExecOptions>,
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
      throw new Error("LocalDockerProvider.exec does not support stdin.");
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

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<LocalDockerExecOptions>,
  ): Promise<ExecStream> {
    const inspect = await this.container.inspect();
    if (!inspect.State?.Running) {
      await this.container.start();
    }

    const providerOptions = options?.providerOptions;
    const env = options?.env
      ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
      : undefined;
    const isTty = providerOptions?.tty ?? false;

    const exec = await this.container.exec({
      Cmd: [command, ...args],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      WorkingDir: options?.cwd,
      Env: env,
      Tty: isTty,
      Privileged: providerOptions?.privileged ?? false,
      User: providerOptions?.user,
    });

    const stream = await exec.start({ hijack: true, stdin: true });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    if (isTty) {
      stream.pipe(stdoutStream);
    } else {
      this.client.modem.demuxStream(stream, stdoutStream, stderrStream);
    }

    if (options?.stdin !== undefined) {
      await writeToNodeStream(stream, options.stdin);
    }

    const exitCode = new Promise<number | null>((resolve, reject) => {
      stream.on("end", async () => {
        stdoutStream.end();
        stderrStream.end();
        try {
          const execInfo = await exec.inspect();
          resolve(execInfo.ExitCode ?? null);
        } catch (error) {
          reject(error);
        }
      });
      stream.on("error", (error) => {
        stdoutStream.destroy(error);
        stderrStream.destroy(error);
        reject(error);
      });
    });

    return {
      stdout: nodeReadableToWeb(stdoutStream),
      stderr: nodeReadableToWeb(stderrStream),
      stdin: nodeWritableToWeb(stream),
      exitCode,
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility = options.visibility ?? "private";
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "public") {
      throw new ServiceUrlError(
        "tunnel_unavailable",
        "Local Docker provider only supports local service URLs.",
      );
    }

    const { url } = await this.resolveLocalUrl(options.port);
    const result: ServiceUrl = { url, visibility: "private" };
    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  private async resolveLocalTarget(
    port: number,
  ): Promise<{ targetHost: string; targetPort: number }> {
    const inspect = await this.container.inspect();
    if (inspect.HostConfig?.NetworkMode === "host") {
      return {
        targetHost: this.portExposure.hostIp,
        targetPort: port,
      };
    }

    const binding = getPortBinding(inspect, port);
    if (!binding) {
      throw new ServiceUrlError(
        "port_unavailable",
        "Requested port is not published. Expose the port when creating the container.",
      );
    }

    const targetHost = normalizeHostIp(binding.HostIp, this.portExposure.hostIp);
    return { targetHost, targetPort: Number(binding.HostPort) };
  }

  private async resolveLocalUrl(port: number): Promise<{ url: string }> {
    const { targetHost, targetPort } = await this.resolveLocalTarget(port);
    return {
      url: `http://${targetHost}:${targetPort}`,
    };
  }
}

const buildPortExposureConfig = (
  exposure: Required<LocalDockerPortExposure>,
): {
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig?: Docker.ContainerCreateOptions["HostConfig"];
} => {
  if (exposure.mode === "host") {
    return { HostConfig: { NetworkMode: "host" } };
  }

  const ports = resolveExposedPorts(exposure);
  if (ports.length === 0) {
    return {};
  }

  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};

  for (const port of ports) {
    const key = `${port}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [
      {
        HostIp: exposure.hostIp,
        HostPort: exposure.publishMode === "random" ? "" : String(port),
      },
    ];
  }

  return {
    ExposedPorts: exposedPorts,
    HostConfig: { PortBindings: portBindings },
  };
};

const resolvePortExposure = (
  input?: LocalDockerPortExposure,
): Required<LocalDockerPortExposure> => ({
  mode: input?.mode ?? "published",
  ports: input?.ports ?? [],
  portRange: input?.portRange ?? { start: 0, end: 0 },
  publishMode: input?.publishMode ?? "same-port",
  hostIp: input?.hostIp ?? "127.0.0.1",
});

const resolveExposedPorts = (exposure: Required<LocalDockerPortExposure>): number[] => {
  const ports = new Set<number>();
  for (const port of exposure.ports) {
    assertValidPort(port);
    ports.add(port);
  }

  if (exposure.portRange.start !== 0 || exposure.portRange.end !== 0) {
    if (exposure.portRange.start > exposure.portRange.end) {
      throw new Error("LocalDockerProvider portRange start must be <= end.");
    }
    for (let port = exposure.portRange.start; port <= exposure.portRange.end; port += 1) {
      assertValidPort(port);
      ports.add(port);
    }
  }

  return [...ports].sort((a, b) => a - b);
};

const assertValidPort = (port: number): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${port}; expected 1-65535.`);
  }
};

const normalizeHostIp = (hostIp: string | undefined, fallback: string): string => {
  if (!hostIp || hostIp === "0.0.0.0" || hostIp === "::") {
    return fallback;
  }
  return hostIp;
};

const getPortBinding = (
  inspect: Docker.ContainerInspectInfo,
  port: number,
): { HostIp: string; HostPort: string } | undefined => {
  const key = `${port}/tcp`;
  const bindings = inspect.NetworkSettings?.Ports?.[key];
  if (!bindings || bindings.length === 0) {
    return undefined;
  }
  return bindings[0];
};

const nodeReadableToWeb = (stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk) => {
        if (typeof chunk === "string") {
          controller.enqueue(new TextEncoder().encode(chunk));
          return;
        }
        controller.enqueue(Buffer.isBuffer(chunk) ? chunk : new Uint8Array(chunk));
      });
      stream.on("end", () => controller.close());
      stream.on("error", (error: Error) => controller.error(error));
    },
    cancel() {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
    },
  });

const nodeWritableToWeb = (stream: NodeJS.WritableStream): WritableStream<Uint8Array> =>
  new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        stream.write(chunk, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        stream.once("error", (error: Error) => reject(error));
        stream.end(() => resolve());
      });
    },
    abort(reason) {
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy(reason instanceof Error ? reason : undefined);
      }
    },
  });

const writeToNodeStream = async (
  stream: NodeJS.WritableStream,
  input: string | Uint8Array,
): Promise<void> => {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;

  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.end(buffer, resolve);
  });
};
