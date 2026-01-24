import type { CommandStartOpts, Sandbox as E2BSandboxClient } from "e2b";
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

import type { E2BExecOptions } from "./types.js";
import { buildCommand, buildCommandWithStdin } from "./internal/command.js";
import { createTextStream } from "./internal/streams.js";
import {
  buildPortCheckScript,
  buildProxyStartScript,
  TCP_PROXY_PORT,
} from "./internal/tcp-proxy.js";

export class E2BSandbox implements Sandbox<E2BSandboxClient, E2BExecOptions> {
  id: SandboxId;
  name?: string;
  native: E2BSandboxClient;

  private sandbox: E2BSandboxClient;
  private allowPublicTraffic?: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: E2BSandboxClient, name?: string, allowPublicTraffic?: boolean) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
    if (allowPublicTraffic !== undefined) {
      this.allowPublicTraffic = allowPublicTraffic;
    }
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("E2BProvider.exec does not support stdin; use native for streaming.");
    }

    const commandString = buildCommand(command, args);
    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const result = await this.sandbox.commands.run(commandString, providerOptions);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<E2BExecOptions>,
  ): Promise<ExecStream> {
    const providerOnStdout = options?.providerOptions?.onStdout;
    const providerOnStderr = options?.providerOptions?.onStderr;

    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const commandString =
      options?.stdin !== undefined
        ? buildCommandWithStdin(command, args, options.stdin)
        : buildCommand(command, args);

    const providerOptions: CommandStartOpts & { background: false } = {
      ...options?.providerOptions,
      background: false,
      onStdout: (data) => {
        stdoutStream.enqueue(data);
        if (providerOnStdout) {
          void providerOnStdout(data);
        }
      },
      onStderr: (data) => {
        stderrStream.enqueue(data);
        if (providerOnStderr) {
          void providerOnStderr(data);
        }
      },
    };

    if (options?.cwd !== undefined) {
      providerOptions.cwd = options.cwd;
    }
    if (options?.env !== undefined) {
      providerOptions.envs = options.env;
    }
    if (options?.timeoutSeconds !== undefined) {
      providerOptions.timeoutMs = options.timeoutSeconds * 1000;
    }

    const resultPromise = this.sandbox.commands.run(commandString, providerOptions);

    resultPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode: resultPromise.then((result) => result.exitCode ?? null),
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const token = this.sandbox.trafficAccessToken;
    const resolvedVisibility =
      options.visibility ??
      (this.allowPublicTraffic === false
        ? "private"
        : this.allowPublicTraffic === true
          ? "public"
          : token
            ? "private"
            : "public");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (this.allowPublicTraffic === undefined && options.visibility !== undefined) {
      if (options.visibility === "public" && token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "public" URL, but the sandbox requires private access (traffic access token is present). Recreate the sandbox with allowPublicTraffic=true or request a private URL.',
        );
      }
      if (options.visibility === "private" && !token) {
        throw new ServiceUrlError(
          "visibility_mismatch",
          'Requested "private" URL, but the sandbox is configured for public traffic (no access token). Recreate the sandbox with allowPublicTraffic=false or request a public URL.',
        );
      }
    }

    if (this.allowPublicTraffic === false && resolvedVisibility === "public") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox was created with allowPublicTraffic=false. Create a new sandbox with allowPublicTraffic=true to enable public URLs.',
      );
    }
    if (this.allowPublicTraffic === true && resolvedVisibility === "private") {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox was created with allowPublicTraffic=true. Create a new sandbox with allowPublicTraffic=false to require private access.',
      );
    }

    const url = `https://${this.sandbox.getHost(options.port)}`;
    let result: ServiceUrl;

    if (resolvedVisibility === "private") {
      if (!token) {
        throw new ServiceUrlError(
          "service_not_ready",
          "Sandbox traffic access token is not available yet.",
        );
      }
      result = {
        url,
        headers: { "e2b-traffic-access-token": token },
        visibility: "private",
      };
    } else {
      result = {
        url,
        visibility: "public",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const token = this.sandbox.trafficAccessToken;
    const resolvedVisibility =
      options.visibility ??
      (this.allowPublicTraffic === false
        ? "private"
        : this.allowPublicTraffic === true
          ? "public"
          : token
            ? "private"
            : "public");

    if (this.allowPublicTraffic === undefined && options.visibility !== undefined) {
      if (options.visibility === "public" && token) {
        throw new TcpProxyError(
          "visibility_mismatch",
          'Requested "public" TCP proxy, but the sandbox requires private access (traffic access token is present). Recreate the sandbox with allowPublicTraffic=true or request a private proxy.',
        );
      }
      if (options.visibility === "private" && !token) {
        throw new TcpProxyError(
          "visibility_mismatch",
          'Requested "private" TCP proxy, but the sandbox is configured for public traffic (no access token). Recreate the sandbox with allowPublicTraffic=false or request a public proxy.',
        );
      }
    }

    if (this.allowPublicTraffic === false && resolvedVisibility === "public") {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "public" TCP proxy, but the sandbox was created with allowPublicTraffic=false. Create a new sandbox with allowPublicTraffic=true to enable public proxies.',
      );
    }
    if (this.allowPublicTraffic === true && resolvedVisibility === "private") {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "private" TCP proxy, but the sandbox was created with allowPublicTraffic=true. Create a new sandbox with allowPublicTraffic=false to require private access.',
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    const url = `wss://${this.sandbox.getHost(TCP_PROXY_PORT)}`;

    if (resolvedVisibility === "private") {
      if (!token) {
        throw new TcpProxyError(
          "service_not_ready",
          "Sandbox traffic access token is not available yet.",
        );
      }
      return {
        url,
        headers: { "e2b-traffic-access-token": token },
        visibility: "private",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    return {
      url,
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

    await this.ensureNodeAvailable();

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
    try {
      const result = await this.exec("sh", ["-c", script]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async waitForPortListening(port: number, timeoutSeconds?: number): Promise<void> {
    const retries = timeoutSeconds ? Math.max(0, Math.ceil(timeoutSeconds)) : 5;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const isListening = await this.checkPortListening(port);
      if (isListening) {
        return;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new TcpProxyError(
      "proxy_unavailable",
      `TCP proxy port ${port} is not listening inside the sandbox.`,
    );
  }

  private async ensureNodeAvailable(): Promise<void> {
    try {
      const result = await this.exec("node", ["-v"]);
      if (result.exitCode === 0) {
        return;
      }
    } catch {
      throw new TcpProxyError(
        "unsupported",
        "TCP proxy requires Node.js to be available inside the sandbox.",
      );
    }
  }
}
