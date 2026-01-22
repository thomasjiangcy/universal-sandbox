# Universal Sandbox

Unified TypeScript API for interacting with remote and local sandbox providers.

## Packages

- `@usbx/core`
- `@usbx/sprites`
- `@usbx/docker`
- `@usbx/e2b`
- `@usbx/daytona`
- `@usbx/modal`
- `@usbx/testing`

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
