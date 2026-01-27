import type Docker from "dockerode";
import { PassThrough } from "node:stream";
import type { ExecOptions, ExecResult, ExecStream, Sandbox, SandboxId } from "@usbx/core";

import type { LocalDockerExecOptions } from "./types.js";
import { nodeReadableToWeb, nodeWritableToWeb, writeToNodeStream } from "./internal/streams.js";

export class LocalDockerSandbox implements Sandbox<Docker.Container, LocalDockerExecOptions> {
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
}
