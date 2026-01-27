import type { CommandStartOpts, SandboxConnectOpts, SandboxOpts } from "e2b";

export type E2BProviderOptions = {
  template?: string;
  createOptions?: SandboxOpts;
  connectOptions?: SandboxConnectOpts;
  allowPublicTraffic?: boolean;
};

export type E2BExecOptions = Omit<
  CommandStartOpts,
  "background" | "cwd" | "envs" | "timeoutMs" | "stdin"
>;
