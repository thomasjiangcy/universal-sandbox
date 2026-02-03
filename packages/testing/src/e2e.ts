import type { Sandbox } from "@usbx/core";

export type RequiredEnv = Record<string, string>;

export type R2Env = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export const getRequiredEnv = (keys: string[]): RequiredEnv | undefined => {
  const env: RequiredEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (!value) {
      return undefined;
    }
    env[key] = value;
  }
  return env;
};

export const getR2Env = (): R2Env | undefined => {
  const env = getRequiredEnv([
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]);
  if (!env) {
    return undefined;
  }
  const bucket = env["R2_BUCKET"];
  const endpoint = env["R2_ENDPOINT"];
  const accessKeyId = env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = env["R2_SECRET_ACCESS_KEY"];
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  return {
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
  };
};

export const buildSandboxName = (prefix: string): string =>
  `${prefix}-${new Date().toISOString().replace(/[^0-9]/g, "")}`;

export const writeFile = async (
  sandbox: Sandbox,
  filePath: string,
  content: string,
): Promise<void> => {
  const escaped = escapeSingleQuoted(content);
  const result = await sandbox.exec("sh", ["-lc", `printf '%s' '${escaped}' > '${filePath}'`]);
  if (result.exitCode !== 0) {
    throw new Error(`writeFile failed: ${result.stderr}`);
  }
};

export const readFile = async (sandbox: Sandbox, filePath: string): Promise<string> => {
  const result = await sandbox.exec("sh", ["-lc", `cat '${filePath}'`]);
  if (result.exitCode !== 0) {
    throw new Error(`readFile failed: ${result.stderr}`);
  }
  return result.stdout;
};

export const escapeSingleQuoted = (value: string): string => value.replace(/'/g, `'"'"'`);
