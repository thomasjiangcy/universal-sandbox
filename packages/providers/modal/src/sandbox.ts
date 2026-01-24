import type { Sandbox as ModalSandboxClient, SandboxExecParams } from "modal";
import { ServiceUrlError, TcpProxyError } from "@usbx/core";
import type {
  ExecOptions as UniversalExecOptions,
  ExecResult,
  ExecStream,
  GetServiceUrlOptions,
  GetTcpProxyOptions,
  Sandbox,
  SandboxId,
  ServiceUrl,
  ServiceUrlVisibility,
  TcpProxyInfo,
} from "@usbx/core";

import { readTextOrEmpty } from "./internal.js";
import type { ModalExecOptions, ModalServiceUrlOptions } from "./types.js";
import { writeToWebStream } from "./internal/streams.js";
import { appendQueryToken } from "./internal/url.js";
import {
  buildPortCheckScript,
  buildProxyStartScript,
  TCP_PROXY_PORT,
} from "./internal/tcp-proxy.js";

export class ModalSandbox implements Sandbox<ModalSandboxClient, ModalExecOptions> {
  id: SandboxId;
  name?: string;
  native: ModalSandboxClient;

  private sandbox: ModalSandboxClient;
  private authMode: ModalServiceUrlOptions["authMode"];
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(
    sandbox: ModalSandboxClient,
    name: string | undefined,
    authMode: ModalServiceUrlOptions["authMode"],
  ) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    this.authMode = authMode;
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
    const execOptions: SandboxExecParams & { mode: "binary" } = {
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

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility: ServiceUrlVisibility = options.visibility ?? "public";
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "public") {
      const timeoutMs = options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined;
      const tunnels = timeoutMs
        ? await this.sandbox.tunnels(timeoutMs)
        : await this.sandbox.tunnels();
      const tunnel = tunnels[options.port];
      if (!tunnel) {
        throw new ServiceUrlError(
          "tunnel_unavailable",
          "Public URLs require forwarded ports. Create the sandbox with forwarded ports enabled to access public URLs.",
        );
      }

      const result: ServiceUrl = {
        url: tunnel.url,
        visibility: "public",
      };
      this.serviceUrlCache.set(options.port, result);
      return result;
    }

    if (options.port !== 8080) {
      throw new ServiceUrlError(
        "port_unavailable",
        "Private URLs use Modal connect tokens, which only support port 8080. Start your HTTP server on port 8080 or request a public URL.",
      );
    }

    const tokenInfo = await this.sandbox.createConnectToken();
    let url = tokenInfo.url;
    let headers: Record<string, string> | undefined;

    if (this.authMode === "query") {
      url = appendQueryToken(url, "_modal_connect_token", tokenInfo.token);
      headers = undefined;
    } else {
      headers = { Authorization: `Bearer ${tokenInfo.token}` };
    }

    const result: ServiceUrl = headers
      ? { url, headers, visibility: "private" }
      : { url, visibility: "private" };

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const resolvedVisibility: ServiceUrlVisibility = options.visibility ?? "public";
    if (resolvedVisibility === "private") {
      throw new TcpProxyError(
        "visibility_mismatch",
        "Modal TCP proxy requires public tunnels; private access is not supported.",
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    const timeoutMs = options.timeoutSeconds ? options.timeoutSeconds * 1000 : undefined;
    const tunnels = timeoutMs
      ? await this.sandbox.tunnels(timeoutMs)
      : await this.sandbox.tunnels();
    const tunnel = tunnels[TCP_PROXY_PORT];
    if (!tunnel) {
      throw new TcpProxyError(
        "tunnel_unavailable",
        "TCP proxy requires forwarded ports. Create the sandbox with encrypted_ports including the proxy port.",
      );
    }

    return {
      url: tunnel.url.replace(/^https:\/\//, "wss://"),
      visibility: "public",
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

    const startResult = await this.exec("sh", [
      "-c",
      buildProxyStartScript(TCP_PROXY_PORT, targetPort),
    ]);
    if (startResult.exitCode === 3) {
      throw new TcpProxyError(
        "unsupported",
        "TCP proxy requires Node.js to be available inside the sandbox.",
      );
    }
    if (startResult.exitCode !== 0) {
      throw new TcpProxyError("proxy_start_failed", "Failed to start TCP proxy.");
    }

    await this.waitForPortListening(TCP_PROXY_PORT, timeoutSeconds);
  }

  private async checkPortListening(port: number): Promise<boolean> {
    const script = buildPortCheckScript(port, 0);
    const result = await this.exec("sh", ["-c", script]);
    return result.exitCode === 0;
  }

  private async waitForPortListening(port: number, timeoutSeconds?: number): Promise<void> {
    const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 5;
    const script = buildPortCheckScript(port, retries);
    const result = await this.exec("sh", ["-c", script]);
    if (result.exitCode === 0) {
      return;
    }
    throw new TcpProxyError(
      "proxy_unavailable",
      `TCP proxy port ${port} is not listening inside the sandbox.`,
    );
  }
}
