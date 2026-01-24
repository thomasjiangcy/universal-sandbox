const escapeShellArg = (value: string): string => {
  if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

export const buildCommand = (command: string, args: string[]): string =>
  [command, ...args].map(escapeShellArg).join(" ");

export const buildCommandWithStdin = (
  command: string,
  args: string[],
  stdin: string | Uint8Array,
): string => {
  const baseCommand = buildCommand(command, args);
  const payload = typeof stdin === "string" ? Buffer.from(stdin, "utf8") : Buffer.from(stdin);
  const base64 = payload.toString("base64");

  return `printf '%s' '${base64}' | base64 -d | ${baseCommand}`;
};
