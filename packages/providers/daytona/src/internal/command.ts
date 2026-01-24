import type { ExecOptions } from "@usbx/core";

import type { DaytonaExecOptions } from "../types.js";

const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

const stdinToBase64 = (stdin: string | Uint8Array): string =>
  (typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin)).toString("base64");

export const buildShellCommand = (
  command: string,
  args: string[],
  options?: ExecOptions<DaytonaExecOptions>,
): string => {
  const baseCommand = buildCommand(command, args);
  const envEntries = options?.env ? Object.entries(options.env) : [];
  const envPrefix =
    envEntries.length > 0
      ? `env ${envEntries.map(([key, value]) => `${key}=${escapeShellArg(value)}`).join(" ")} `
      : "";
  const commandWithEnv = `${envPrefix}${baseCommand}`;

  const commandWithStdin =
    options?.stdin !== undefined
      ? `printf '%s' '${stdinToBase64(options.stdin)}' | base64 -d | ${commandWithEnv}`
      : commandWithEnv;

  if (options?.cwd) {
    return `cd ${escapeShellArg(options.cwd)} && ${commandWithStdin}`;
  }

  return commandWithStdin;
};
