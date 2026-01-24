import type Docker from "dockerode";
import { PassThrough } from "node:stream";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  ExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  ServiceUrl,
  TcpProxyInfo,
} from "@usbx/core";

import type { LocalDockerExecOptions, LocalDockerPortExposure } from "./types.js";
import { getPortBinding, normalizeHostIp } from "./internal/ports.js";
import { nodeReadableToWeb, nodeWritableToWeb, writeToNodeStream } from "./internal/streams.js";
import {
  buildPortCheckScript,
  buildProxyPrepareScript,
  TCP_PROXY_PORT,
} from "./internal/tcp-proxy.js";

export class LocalDockerSandbox implements Sandbox<Docker.Container, LocalDockerExecOptions> {
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
