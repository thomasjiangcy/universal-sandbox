import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const KNOWN_PROVIDERS = ["docker", "e2b", "daytona", "modal", "sprites"];
const REQUIRED_ENV_BY_PROVIDER = {
  sprites: ["SPRITES_TOKEN"],
};

const helpText = `provider-e2e

Run provider e2e tests with optional provider filtering and env loading.

Usage:
  pnpm test:providers [--all] [--providers <list>] [--env <path>] [--no-env]

Options:
  --all                Run all provider e2e tests (default if none selected)
  --providers, -p      Comma-separated provider list (e.g. e2b,sprites)
  --env                Path to env file (default: .env.providers)
  --no-env             Skip loading env file
  --list               List available providers and exit
  --help, -h           Show this help text
`;

const parseArgs = (args) => {
  const providerArgs = [];
  let envPath = ".env.providers";
  let loadEnv = true;
  let listOnly = false;
  let runAll = false;
  const unknownArgs = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--providers" || arg === "-p") {
      const value = args[i + 1];
      if (!value) {
        unknownArgs.push(arg);
        continue;
      }
      providerArgs.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--providers=")) {
      providerArgs.push(arg.split("=").slice(1).join("="));
      continue;
    }
    if (arg === "--all") {
      runAll = true;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    if (arg === "--env") {
      const value = args[i + 1];
      if (!value) {
        unknownArgs.push(arg);
        continue;
      }
      envPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--env=")) {
      envPath = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--no-env") {
      loadEnv = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(helpText);
      process.exit(0);
    }
    unknownArgs.push(arg);
  }

  if (unknownArgs.length > 0) {
    console.error(`Unknown or incomplete args: ${unknownArgs.join(", ")}`);
    console.log(helpText);
    process.exit(1);
  }

  return { providerArgs, envPath, loadEnv, listOnly, runAll };
};

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

const normalizeProviders = (providerArgs, runAll) => {
  const selected = new Set();
  for (const raw of providerArgs) {
    const parts = raw.split(",").map((value) => value.trim());
    for (const name of parts) {
      if (name) {
        selected.add(name);
      }
    }
  }

  if (runAll || selected.size === 0) {
    return [...KNOWN_PROVIDERS];
  }

  return [...selected];
};

const validateProviders = (providers) => {
  const invalid = providers.filter((name) => !KNOWN_PROVIDERS.includes(name));
  if (invalid.length > 0) {
    console.error(`Unknown provider(s): ${invalid.join(", ")}`);
    console.error(`Available: ${KNOWN_PROVIDERS.join(", ")}`);
    process.exit(1);
  }
};

const checkRequiredEnv = (providers) => {
  const missing = [];
  for (const provider of providers) {
    const required = REQUIRED_ENV_BY_PROVIDER[provider];
    if (!required) {
      continue;
    }
    for (const key of required) {
      if (!process.env[key]) {
        missing.push(`${provider}:${key}`);
      }
    }
  }
  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    for (const entry of missing) {
      console.error(`- ${entry}`);
    }
    process.exit(1);
  }
};

const run = () => {
  const { providerArgs, envPath, loadEnv, listOnly, runAll } = parseArgs(process.argv.slice(2));

  if (listOnly) {
    console.log(KNOWN_PROVIDERS.join("\n"));
    return;
  }

  const providers = normalizeProviders(providerArgs, runAll);
  validateProviders(providers);

  if (loadEnv) {
    const resolved = resolve(process.cwd(), envPath);
    if (existsSync(resolved)) {
      parseEnvFile(resolved);
      console.log(`Loaded env from ${envPath}`);
    } else {
      console.warn(`Env file not found: ${envPath}`);
    }
  }

  checkRequiredEnv(providers);

  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  console.log(`Running provider e2e tests: ${providers.join(", ")}`);
  const filters = providers.flatMap((provider) => ["-F", `@usbx/${provider}`]);
  const child = spawn(pnpmCommand, [...filters, "test:e2e"], {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
};

run();
