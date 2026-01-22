import { readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackageJsonPath = resolve(rootDir, "packages/core/package.json");
const corePackageJson = JSON.parse(await readFile(corePackageJsonPath, "utf8"));

const defaultPackagesToPublish = [
  "packages/providers/daytona",
  "packages/providers/e2b",
  "packages/providers/modal",
];

const npmToken = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
if (!npmToken) {
  throw new Error("Set NPM_TOKEN (or NODE_AUTH_TOKEN) before running this script.");
}

const publishEnv = {
  ...process.env,
  NODE_AUTH_TOKEN: npmToken,
  NPM_CONFIG_PROVENANCE: "false",
};

const originalPackageJsons = new Map();

const isDirectory = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const resolvePackageDir = async (input) => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Package input cannot be empty.");
  }

  const directPath = resolve(rootDir, trimmed);
  if (await isDirectory(directPath)) {
    return directPath;
  }

  const normalizedName = trimmed.startsWith("@usbx/") ? trimmed.slice("@usbx/".length) : trimmed;

  const providerPath = resolve(rootDir, "packages/providers", normalizedName);
  if (await isDirectory(providerPath)) {
    return providerPath;
  }

  const packagePath = resolve(rootDir, "packages", normalizedName);
  if (await isDirectory(packagePath)) {
    return packagePath;
  }

  throw new Error(`Unable to resolve package directory for "${input}".`);
};

const updatePackageJson = async (pkgDir) => {
  const packageJsonPath = resolve(pkgDir, "package.json");
  const original = await readFile(packageJsonPath, "utf8");
  originalPackageJsons.set(packageJsonPath, original);

  const data = JSON.parse(original);
  data.version = "0.0.0";
  if (data.dependencies?.["@usbx/core"]) {
    data.dependencies["@usbx/core"] = corePackageJson.version;
  }

  await writeFile(packageJsonPath, `${JSON.stringify(data, null, 2)}\n`);
};

const restorePackageJsons = async () => {
  await Promise.all(
    [...originalPackageJsons.entries()].map(([path, contents]) => writeFile(path, contents)),
  );
};

const run = (command, args, cwd) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: publishEnv,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} exited with code ${code}`));
      }
    });
  });

const packageInputs = process.argv.length > 2 ? process.argv.slice(2) : defaultPackagesToPublish;
const packageDirs = [];

try {
  for (const input of packageInputs) {
    packageDirs.push(await resolvePackageDir(input));
  }

  for (const pkgDir of packageDirs) {
    await updatePackageJson(pkgDir);
  }

  for (const pkgDir of packageDirs) {
    await run("npm", ["publish", "--access", "public", "--tag", "alpha"], pkgDir);
  }
} finally {
  await restorePackageJsons();
}
