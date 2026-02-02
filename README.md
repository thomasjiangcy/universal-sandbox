# Universal Sandbox

Unified TypeScript API for interacting with local and remote sandbox providers.

## Quickstart

Install the core runtime and the provider you want to use:

```
pnpm add @usbx/core @usbx/modal
```

```ts
import { createSandboxClient } from "@usbx/core";
import { ModalProvider } from "@usbx/modal";

const client = createSandboxClient({
  provider: new ModalProvider({
    appName: "usbx-sandbox",
    imageRef: "python:3.13-slim",
  }),
});

const sbx = await client.create();
const result = await sbx.exec("echo", ["hello"]);
```

## Local Development vs Production

For local development, prefer the Docker provider for fast iteration. For
production, swap in the provider that matches your hosted environment.

```
pnpm add @usbx/local-docker
```

```ts
import { createSandboxClient } from "@usbx/core";
import { LocalDockerProvider } from "@usbx/local-docker";

const client = createSandboxClient({
  provider: new LocalDockerProvider({ defaultImage: "alpine" }),
});

const sbx = await client.create({ name: "my-container" });
const result = await sbx.exec("echo", ["hello"]);
```

Note: the local Docker provider requires Docker to be installed and running.

## Providers

| Provider     | Package              | Best for               | Credentials / Notes                                     |
| ------------ | -------------------- | ---------------------- | ------------------------------------------------------- |
| Local Docker | `@usbx/local-docker` | Local development      | Requires Docker installed and running. Local URLs only. |
| Modal        | `@usbx/modal`        | Hosted sandboxes       | Configure app/image. `get` expects a sandbox id.        |
| Sprites      | `@usbx/sprites`      | Hosted sandboxes       | Requires `SPRITES_TOKEN`.                               |
| E2B          | `@usbx/e2b`          | Hosted sandboxes       | `get` expects a sandbox id.                             |
| Daytona      | `@usbx/daytona`      | Hosted sandboxes       | `executeCommand` does not return stderr.                |
| Testing      | `@usbx/testing`      | Unit/integration tests | In-memory local provider.                               |

## Common API Surface

- `create` a sandbox with optional name and image/config per provider
- `get` a sandbox (by name for some providers, by id for others)
- `exec` a command inside the sandbox
- `images` to build or pull base images when supported
- `delete` to clean up

Provider differences and edge cases are documented in each package README.

## Packages

- `@usbx/core`
- `@usbx/sprites`
- `@usbx/local-docker`
- `@usbx/e2b`
- `@usbx/daytona`
- `@usbx/modal`
- `@usbx/testing`

## Public APIs

Universal Sandbox is organized around a small public API surface. You construct
a `SandboxClient` with a provider (or use `createSandboxClient` for stricter
typing), then work with the `Sandbox` instances it creates or fetches.

- `@usbx/core` exports `SandboxClient`, `createSandboxClient`, and shared types used by all providers.
- Each provider package exports a single provider class (for example,
  `ModalProvider`, `LocalDockerProvider`, `SpritesProvider`, `E2BProvider`,
  `DaytonaProvider`).
- Provider-specific extras and edge cases are documented in each package README.

### Client (SandboxClient)

| Method   | Signature                         | Returns                        | Description                                                                              |
| -------- | --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `create` | `create(options?: CreateOptions)` | `Promise<Sandbox>`             | Creates a new sandbox via the provider.                                                  |
| `get`    | `get(idOrName: string)`           | `Promise<Sandbox>`             | Fetches an existing sandbox by id or name (provider-dependent).                          |
| `delete` | `delete(idOrName: string)`        | `Promise<void>`                | Deletes a sandbox by id or name (provider-dependent).                                    |
| `images` | `get images()`                    | `ImageBuilder \| undefined`    | Optional provider image builder API (required when supported via `createSandboxClient`). |
| `native` | `get native()`                    | `TProviderNative \| undefined` | Access to the provider’s native client if exposed.                                       |

### Factory (createSandboxClient)

The factory returns a client with stricter typing for `images` when the provider
supports image building.

### Sandbox Instance

| Method       | Signature                                                             | Returns                       | Description                                                               |
| ------------ | --------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `exec`       | `exec(command: string, args?: string[], options?: ExecOptions)`       | `Promise<ExecResult>`         | Executes a command and returns stdout, stderr, and exit code.             |
| `execStream` | `execStream(command: string, args?: string[], options?: ExecOptions)` | `Promise<ExecStream>`         | Executes a command with streaming stdout/stderr (stdin may be supported). |
| `native`     | `native?`                                                             | `TSandboxNative \| undefined` | Access to the provider’s native sandbox handle if exposed.                |

## Provider Docs

- [`packages/core/README.md`](packages/core/README.md)
- [`packages/providers/local-docker/README.md`](packages/providers/local-docker/README.md)
- [`packages/providers/modal/README.md`](packages/providers/modal/README.md)
- [`packages/providers/sprites/README.md`](packages/providers/sprites/README.md)
- [`packages/providers/e2b/README.md`](packages/providers/e2b/README.md)
- [`packages/providers/daytona/README.md`](packages/providers/daytona/README.md)
- [`packages/testing/README.md`](packages/testing/README.md)

## Development

- `pnpm install`
- `pnpm lint`
- `pnpm format`
- `pnpm typecheck`
- `pnpm test`

## Provider E2E Testing

- Copy `.env.providers.example` to `.env.providers` and add provider credentials
- Run all provider e2e tests: `pnpm test:providers`
- Run a subset: `pnpm test:providers --providers e2b,sprites`
- List providers: `pnpm test:providers --list`

## Tooling

This repo uses `mise` to pin tool versions (Node and pnpm). If you don't use mise,
just install Node `24.13.0` and pnpm `10.28.1` locally.

## Release Bootstrap

Trusted publishing (OIDC) requires packages to already exist on npm. For new
packages, bootstrap a `0.0.0` release using a temporary npm token:

```bash
NPM_TOKEN=your_token_here node scripts/bootstrap-publish-new-packages.mjs \
  packages/providers/daytona packages/providers/e2b packages/providers/modal
```

The script also accepts package names like `daytona` or `@usbx/daytona`.
