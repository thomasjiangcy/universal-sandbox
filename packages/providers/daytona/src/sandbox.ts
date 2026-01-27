import type { Sandbox as DaytonaSandboxClient } from "@daytonaio/sdk";
import type { ExecOptions, ExecResult, ExecStream, Sandbox, SandboxId } from "@usbx/core";

import type { DaytonaExecOptions } from "./types.js";
import { buildShellCommand } from "./internal/command.js";
import { createTextStream } from "./internal/streams.js";

export class DaytonaSandbox implements Sandbox<DaytonaSandboxClient, DaytonaExecOptions> {
  id: SandboxId;
  name?: string;
  native: DaytonaSandboxClient;

  private sandbox: DaytonaSandboxClient;

  constructor(sandbox: DaytonaSandboxClient) {
    this.id = sandbox.id;
    this.name = sandbox.name;
    this.sandbox = sandbox;
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
}
