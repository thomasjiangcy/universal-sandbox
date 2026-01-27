import type { Sandbox as ModalSandboxClient, SandboxExecParams } from "modal";
import type {
  ExecOptions as UniversalExecOptions,
  ExecResult,
  ExecStream,
  Sandbox,
  SandboxId,
} from "@usbx/core";

import { readTextOrEmpty } from "./internal.js";
import type { ModalExecOptions } from "./types.js";
import { writeToWebStream } from "./internal/streams.js";

export class ModalSandbox implements Sandbox<ModalSandboxClient, ModalExecOptions> {
  id: SandboxId;
  name?: string;
  native: ModalSandboxClient;

  private sandbox: ModalSandboxClient;

  constructor(sandbox: ModalSandboxClient, name: string | undefined) {
    this.id = sandbox.sandboxId;
    if (name) {
      this.name = name;
    }
    this.sandbox = sandbox;
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
}
