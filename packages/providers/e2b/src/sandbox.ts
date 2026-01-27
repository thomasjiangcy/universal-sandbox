import type { CommandStartOpts, Sandbox as E2BSandboxClient } from "e2b";
import type { ExecOptions, ExecResult, ExecStream, Sandbox, SandboxId } from "@usbx/core";

import type { E2BExecOptions } from "./types.js";
import { buildCommand, buildCommandWithStdin } from "./internal/command.js";
import { createTextStream } from "./internal/streams.js";

export class E2BSandbox implements Sandbox<E2BSandboxClient, E2BExecOptions> {
  id: SandboxId;
  name?: string;
  native: E2BSandboxClient;

  private sandbox: E2BSandboxClient;

  constructor(sandbox: E2BSandboxClient, name?: string) {
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
}
