import type { Sandbox as DaytonaSandboxClient } from "@daytonaio/sdk";
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

import type { DaytonaExecOptions } from "./types.js";
import { buildShellCommand } from "./internal/command.js";
import { createTextStream } from "./internal/streams.js";
import {
  buildPortCheckScript,
  buildProxyStartScript,
  TCP_PROXY_PORT,
} from "./internal/tcp-proxy.js";

export class DaytonaSandbox implements Sandbox<DaytonaSandboxClient, DaytonaExecOptions> {
  id: SandboxId;
  name?: string;
  native: DaytonaSandboxClient;

  private sandbox: DaytonaSandboxClient;
  private preferSignedUrl: boolean;
  private serviceUrlCache = new Map<number, ServiceUrl>();

  constructor(sandbox: DaytonaSandboxClient, preferSignedUrl: boolean) {
    this.id = sandbox.id;
    this.name = sandbox.name;
    this.sandbox = sandbox;
    this.preferSignedUrl = preferSignedUrl;
    this.native = sandbox;
  }

  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecResult> {
    if (options?.stdin !== undefined) {
      throw new Error("DaytonaProvider.exec does not support stdin.");
    }

    const commandString = buildShellCommand(command, args, options);
    const result = await this.sandbox.process.executeCommand(
      commandString,
      options?.cwd,
      options?.env,
      options?.timeoutSeconds,
    );

    return {
      stdout: result.artifacts?.stdout ?? result.result ?? "",
      stderr: "",
      exitCode: result.exitCode ?? null,
    };
  }

  async execStream(
    command: string,
    args: string[] = [],
    options?: ExecOptions<DaytonaExecOptions>,
  ): Promise<ExecStream> {
    const stdoutStream = createTextStream();
    const stderrStream = createTextStream();

    const sessionId = `usbx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await this.sandbox.process.createSession(sessionId);

    const commandString = buildShellCommand(command, args, options);
    const response = await this.sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: commandString,
        runAsync: true,
      },
      options?.timeoutSeconds,
    );

    if (!response.cmdId) {
      await this.sandbox.process.deleteSession(sessionId);
      throw new Error("DaytonaProvider.execStream did not return a command id.");
    }

    const logsPromise = this.sandbox.process.getSessionCommandLogs(
      sessionId,
      response.cmdId,
      (chunk) => stdoutStream.enqueue(chunk),
      (chunk) => stderrStream.enqueue(chunk),
    );

    logsPromise
      .then(() => {
        stdoutStream.close();
        stderrStream.close();
      })
      .catch((error) => {
        stdoutStream.error(error);
        stderrStream.error(error);
      });

    const exitCode = logsPromise
      .then(async () => {
        const commandInfo = await this.sandbox.process.getSessionCommand(sessionId, response.cmdId);
        return commandInfo.exitCode ?? null;
      })
      .finally(async () => {
        try {
          await this.sandbox.process.deleteSession(sessionId);
        } catch {
          // Best-effort cleanup.
        }
      });

    return {
      stdout: stdoutStream.readable,
      stderr: stderrStream.readable,
      exitCode,
    };
  }

  async getServiceUrl(options: GetServiceUrlOptions): Promise<ServiceUrl> {
    const resolvedVisibility = options.visibility ?? (this.sandbox.public ? "public" : "private");
    const cached = this.serviceUrlCache.get(options.port);
    if (cached && cached.visibility === resolvedVisibility) {
      return cached;
    }

    if (resolvedVisibility === "private" && this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "private" URL, but the sandbox is public. Create a private sandbox or use a signed preview URL if supported.',
      );
    }
    if (resolvedVisibility === "public" && !this.sandbox.public) {
      throw new ServiceUrlError(
        "visibility_mismatch",
        'Requested "public" URL, but the sandbox is private. Create a public sandbox or request a private URL.',
      );
    }

    const previewInfo = await this.sandbox.getPreviewLink(options.port);
    let result: ServiceUrl;

    if (resolvedVisibility === "public") {
      result = {
        url: previewInfo.url,
        visibility: "public",
      };
    } else if (this.preferSignedUrl) {
      const signedPreview = await this.sandbox.getSignedPreviewUrl(options.port);
      result = {
        url: signedPreview.url,
        visibility: "private",
      };
    } else {
      result = {
        url: previewInfo.url,
        headers: { "x-daytona-preview-token": previewInfo.token },
        visibility: "private",
      };
    }

    this.serviceUrlCache.set(options.port, result);
    return result;
  }

  async getTcpProxy(options: GetTcpProxyOptions): Promise<TcpProxyInfo> {
    const resolvedVisibility = options.visibility ?? (this.sandbox.public ? "public" : "private");

    if (resolvedVisibility === "private" && this.sandbox.public) {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "private" TCP proxy, but the sandbox is public. Create a private sandbox or use a signed preview URL if supported.',
      );
    }
    if (resolvedVisibility === "public" && !this.sandbox.public) {
      throw new TcpProxyError(
        "visibility_mismatch",
        'Requested "public" TCP proxy, but the sandbox is private. Create a public sandbox or request a private proxy.',
      );
    }

    await this.ensureTcpProxyRunning(options.port, options.timeoutSeconds);

    if (resolvedVisibility === "public") {
      const previewInfo = await this.sandbox.getPreviewLink(TCP_PROXY_PORT);
      return {
        url: previewInfo.url.replace(/^https:\/\//, "wss://"),
        visibility: "public",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    if (this.preferSignedUrl) {
      const signedPreview = await this.sandbox.getSignedPreviewUrl(TCP_PROXY_PORT);
      return {
        url: signedPreview.url.replace(/^https:\/\//, "wss://"),
        visibility: "private",
        protocol: "sprites-tcp-proxy-v1",
        init: {
          hostDefault: "localhost",
          requiresHost: false,
        },
      };
    }

    const previewInfo = await this.sandbox.getPreviewLink(TCP_PROXY_PORT);
    return {
      url: previewInfo.url.replace(/^https:\/\//, "wss://"),
      headers: { "x-daytona-preview-token": previewInfo.token },
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
