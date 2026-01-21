import type { ExecResult, Sandbox, SandboxProvider } from "@universal/core";

export type LocalProviderOptions = {
  defaultName?: string;
};

export class LocalSandbox implements Sandbox<undefined, undefined> {
  id: string;
  name?: string;

  constructor(id: string) {
    this.id = id;
    this.name = id;
  }

  async exec(_command: string, _args: string[] = []): Promise<ExecResult> {
    return {
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    };
  }
}

export class LocalProvider implements SandboxProvider<undefined, undefined, undefined> {
  private sandboxes = new Map<string, LocalSandbox>();
  private defaultName: string;

  constructor(options: LocalProviderOptions = {}) {
    this.defaultName = options.defaultName ?? "local";
  }

  async create(options?: { name?: string }): Promise<Sandbox<undefined, undefined>> {
    const name = options?.name ?? this.defaultName;
    const existing = this.sandboxes.get(name);
    if (existing) {
      return existing;
    }

    const sandbox = new LocalSandbox(name);
    this.sandboxes.set(name, sandbox);
    return sandbox;
  }

  async get(idOrName: string): Promise<Sandbox<undefined, undefined>> {
    const sandbox = this.sandboxes.get(idOrName);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${idOrName}`);
    }
    return sandbox;
  }
}