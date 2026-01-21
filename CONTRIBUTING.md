# Contributing

Thanks for your interest in contributing to Universal Sandbox.

## Getting Started

- Install dependencies: `pnpm install`
- Run lint: `pnpm lint`
- Run format: `pnpm format`
- Run typecheck: `pnpm typecheck`
- Run tests: `pnpm test`

## Development Notes

- Providers live under `packages/providers/`.
- The core runtime is in `packages/core/`.
- Use `pnpm -F <package> <script>` to run package-specific scripts.

## Pull Requests

- Keep PRs focused and small.
- Update or add tests when changing behavior.
- Ensure `pnpm lint` and `pnpm typecheck` pass.