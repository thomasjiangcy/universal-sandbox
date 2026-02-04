import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const parseEnvFile = (filePath) => {
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

const findRepoRoot = () => {
  let current = process.cwd();
  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
};

const loadProvidersEnv = () => {
  const root = findRepoRoot();
  const envPath = resolve(root, ".env.providers");
  if (existsSync(envPath)) {
    parseEnvFile(envPath);
    console.log("Loaded env from .env.providers");
  } else {
    console.warn("Env file not found: .env.providers");
  }
};

loadProvidersEnv();

const args = ["run", "e2e", ...process.argv.slice(2)];
const child = spawn("vitest", args, { stdio: "inherit" });
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
