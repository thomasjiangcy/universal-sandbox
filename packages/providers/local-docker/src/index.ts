import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  CreateOptions,
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  SandboxProvider,
  ServiceUrl,
  TcpProxyInfo,
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
  private tcpProxyStream?: NodeJS.ReadableStream;

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

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    if (options.visibility === "public") {
      throw new TcpProxyError(
        "visibility_mismatch",
        "Local Docker provider only supports local TCP proxies.",
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    let url: string;
    try {
      const result = await this.resolveLocalUrl(TCP_PROXY_PORT);
      url = result.url;
    } catch (error) {
      if (error instanceof ServiceUrlError) {
        throw new TcpProxyError(error.code, error.message);
      }
      throw error;
    }
    return {
      url: url.replace(/^http:\/\//, "ws://"),
      visibility: "private",
      protocol: "sprites-tcp-proxy-v1",
      init: {
        hostDefault: "localhost",
        requiresHost: false,
      },
    };
  }

  private async ensureTcpProxyRunning(targetPort: number, timeoutSeconds?: number): Promise<void> {
    const listening = await this.checkPortListening(TCP_PROXY_PORT);
    if (listening) {
      return;
    }

    await this.startTcpProxyProcess(targetPort);

    await this.waitForPortListening(TCP_PROXY_PORT, timeoutSeconds);
  }

  private async checkPortListening(port: number): Promise<boolean> {
    const script = buildPortCheckScript(port, 0);
    const result = await this.exec("sh", ["-c", script]);
    if (result.exitCode === 0) {
      return true;
    }
    if (result.exitCode === 2) {
      return this.checkPortWithNode(port);
    }
    return false;
  }

  private async waitForPortListening(port: number, timeoutSeconds?: number): Promise<void> {
    const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 5;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const listening = await this.checkPortListening(port);
      if (listening) {
        return;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new TcpProxyError(
      "proxy_unavailable",
      `TCP proxy port ${port} is not listening inside the container.`,
    );
  }

  private async checkPortWithNode(port: number): Promise<boolean> {
    const script = [
      'node -e "',
      "const net=require('net');",
      `const socket=net.connect(${port},'127.0.0.1');`,
      "socket.on('connect',()=>{socket.end();process.exit(0);});",
      "socket.on('error',()=>process.exit(1));",
      '"',
    ].join("");
    const result = await this.exec("sh", ["-c", script]);
    return result.exitCode === 0;
  }

  private async startTcpProxyProcess(targetPort: number): Promise<void> {
    const startResult = await this.exec("sh", ["-c", buildProxyPrepareScript()]);
    if (startResult.exitCode === 3) {
      throw new TcpProxyError(
        "unsupported",
        "TCP proxy requires Node.js to be available inside the container.",
      );
    }
    if (startResult.exitCode !== 0) {
      throw new TcpProxyError("proxy_start_failed", "Failed to prepare TCP proxy.");
    }

    const exec = await this.container.exec({
      Cmd: ["node", "/tmp/usbx-tcp-proxy.js"],
      Env: [`US_BX_TCP_PROXY_PORT=${TCP_PROXY_PORT}`, `US_BX_TCP_PROXY_TARGET_PORT=${targetPort}`],
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    this.tcpProxyStream = stream;
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

const TCP_PROXY_PORT = 9000;

const TCP_PROXY_SCRIPT = [
  "const http = require('http');",
  "const crypto = require('crypto');",
  "const net = require('net');",
  "const PORT = Number(process.env.US_BX_TCP_PROXY_PORT || '9000');",
  "const TARGET_PORT = process.env.US_BX_TCP_PROXY_TARGET_PORT ? Number(process.env.US_BX_TCP_PROXY_TARGET_PORT) : null;",
  "const INIT_TIMEOUT_MS = 5000;",
  "const MAX_INIT_BYTES = 4096;",
  "const server = http.createServer();",
  "const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';",
  "const sendFrame = (socket, opcode, payload) => {",
  "  const length = payload.length;",
  "  let header;",
  "  if (length < 126) {",
  "    header = Buffer.alloc(2);",
  "    header[1] = length;",
  "  } else if (length < 65536) {",
  "    header = Buffer.alloc(4);",
  "    header[1] = 126;",
  "    header.writeUInt16BE(length, 2);",
  "  } else {",
  "    header = Buffer.alloc(10);",
  "    header[1] = 127;",
  "    header.writeBigUInt64BE(BigInt(length), 2);",
  "  }",
  "  header[0] = 0x80 | (opcode & 0x0f);",
  "  socket.write(Buffer.concat([header, payload]));",
  "};",
  "const parseFrames = (buffer) => {",
  "  const frames = [];",
  "  let offset = 0;",
  "  while (offset + 2 <= buffer.length) {",
  "    const byte1 = buffer[offset];",
  "    const byte2 = buffer[offset + 1];",
  "    const fin = (byte1 & 0x80) !== 0;",
  "    const opcode = byte1 & 0x0f;",
  "    const masked = (byte2 & 0x80) !== 0;",
  "    let length = byte2 & 0x7f;",
  "    let headerSize = 2;",
  "    if (length === 126) {",
  "      if (offset + 4 > buffer.length) break;",
  "      length = buffer.readUInt16BE(offset + 2);",
  "      headerSize = 4;",
  "    } else if (length === 127) {",
  "      if (offset + 10 > buffer.length) break;",
  "      const value = buffer.readBigUInt64BE(offset + 2);",
  "      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame too large');",
  "      length = Number(value);",
  "      headerSize = 10;",
  "    }",
  "    const maskOffset = offset + headerSize;",
  "    const dataOffset = maskOffset + (masked ? 4 : 0);",
  "    const frameEnd = dataOffset + length;",
  "    if (frameEnd > buffer.length) break;",
  "    let payload = buffer.subarray(dataOffset, frameEnd);",
  "    if (masked) {",
  "      const mask = buffer.subarray(maskOffset, maskOffset + 4);",
  "      const unmasked = Buffer.alloc(payload.length);",
  "      for (let i = 0; i < payload.length; i += 1) {",
  "        unmasked[i] = payload[i] ^ mask[i % 4];",
  "      }",
  "      payload = unmasked;",
  "    }",
  "    frames.push({ fin, opcode, payload });",
  "    offset = frameEnd;",
  "  }",
  "  return { frames, remaining: buffer.subarray(offset) };",
  "};",
  "server.on('upgrade', (req, socket) => {",
  "  const key = req.headers['sec-websocket-key'];",
  "  if (typeof key !== 'string') {",
  "    socket.end('HTTP/1.1 400 Bad Request\\r\\n\\r\\n');",
  "    return;",
  "  }",
  "  const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');",
  "  const response = [",
  "    'HTTP/1.1 101 Switching Protocols',",
  "    'Upgrade: websocket',",
  "    'Connection: Upgrade',",
  "    'Sec-WebSocket-Accept: ' + accept,",
  "    '\\r\\n',",
  "  ].join('\\r\\n');",
  "  socket.write(response);",
  "  socket.setNoDelay(true);",
  "  let buffer = Buffer.alloc(0);",
  "  let initialized = false;",
  "  let tcp = null;",
  "  const initTimer = setTimeout(() => {",
  "    socket.end();",
  "    if (tcp) tcp.destroy();",
  "  }, INIT_TIMEOUT_MS);",
  "  const close = () => {",
  "    clearTimeout(initTimer);",
  "    if (tcp) tcp.destroy();",
  "    socket.end();",
  "  };",
  "  socket.on('data', (chunk) => {",
  "    buffer = Buffer.concat([buffer, chunk]);",
  "    let parsed;",
  "    try {",
  "      parsed = parseFrames(buffer);",
  "    } catch {",
  "      close();",
  "      return;",
  "    }",
  "    buffer = parsed.remaining;",
  "    for (const frame of parsed.frames) {",
  "      if (!frame.fin) {",
  "        close();",
  "        return;",
  "      }",
  "      if (frame.opcode === 0x8) {",
  "        close();",
  "        return;",
  "      }",
  "      if (frame.opcode === 0x9) {",
  "        sendFrame(socket, 0xA, frame.payload);",
  "        continue;",
  "      }",
  "      if (!initialized) {",
  "        if (frame.opcode !== 0x1 || frame.payload.length > MAX_INIT_BYTES) {",
  "          close();",
  "          return;",
  "        }",
  "        let init;",
  "        try {",
  "          init = JSON.parse(frame.payload.toString('utf8'));",
  "        } catch {",
  "          close();",
  "          return;",
  "        }",
  "        const host = typeof init.host === 'string' ? init.host : 'localhost';",
  "        const port = init.port;",
  "        if (!Number.isInteger(port) || port < 1 || port > 65535) {",
  "          close();",
  "          return;",
  "        }",
  "        if (TARGET_PORT && port !== TARGET_PORT) {",
  "          close();",
  "          return;",
  "        }",
  "        if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {",
  "          close();",
  "          return;",
  "        }",
  "        tcp = net.createConnection({ host, port });",
  "        tcp.on('connect', () => {",
  "          initialized = true;",
  "          clearTimeout(initTimer);",
  "          sendFrame(socket, 0x1, Buffer.from(JSON.stringify({ status: 'connected', target: host + ':' + port })));",
  "        });",
  "        tcp.on('data', (data) => sendFrame(socket, 0x2, data));",
  "        tcp.on('error', close);",
  "        tcp.on('close', close);",
  "        continue;",
  "      }",
  "      if (frame.opcode === 0x2 && tcp) {",
  "        tcp.write(frame.payload);",
  "      }",
  "    }",
  "  });",
  "  socket.on('close', close);",
  "  socket.on('error', close);",
  "});",
  "server.listen(PORT, '0.0.0.0');",
].join("\n");

const buildProxyPrepareScript = (): string => {
  const scriptPath = "/tmp/usbx-tcp-proxy.js";
  return [
    "if ! command -v node >/dev/null 2>&1; then",
    "  exit 3",
    "fi",
    `cat <<'US_BX_TCP_PROXY' > ${scriptPath}`,
    TCP_PROXY_SCRIPT,
    "US_BX_TCP_PROXY",
  ].join("\n");
};

const buildPortCheckScript = (port: number, retries: number): string => `
check_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | awk 'NR>1 {found=1} END {exit found?0:1}'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nPiTCP:${port} -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  return 2
}

i=0
while [ $i -le ${retries} ]; do
  check_port
  rc=$?
  if [ $rc -eq 0 ]; then
    exit 0
  fi
  if [ $rc -eq 2 ]; then
    exit 2
  fi
  i=$((i+1))
  if [ $i -le ${retries} ]; then
    sleep 1
  fi
done
exit 1
`;
