## Project overview
- Monorepo for Universal Sandbox, a unified TypeScript API for local and remote sandbox providers.
- Packages live under `packages/` and `packages/providers/`.
- Core runtime: `packages/core/`. Providers: `packages/providers/*`. Testing helpers: `packages/testing/`.

## Tooling and environment
- Uses `pnpm` workspaces and `turbo` for tasks.
- Tool versions are pinned via `mise.toml`: Node `24.13.0`, pnpm `10.28.1`.
- If you do not use mise, install the versions above locally.

## Install
- `pnpm install`

## Common scripts (repo root)
- `pnpm build` (turbo build)
- `pnpm lint` (oxlint)
- `pnpm format` (oxfmt)
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`

## Package-specific scripts
- Use `pnpm -F <package> <script>` for per-package tasks.
- Package names: `@usbx/core`, `@usbx/docker`, `@usbx/sprites`, `@usbx/testing`.

## TypeScript guidelines
- Everything must be type-safe; avoid unsafe patterns that bypass the type system.
- Do not use `any`.
- Avoid type assertions (`as`). Prefer proper typing, narrowing, and type guards.
- Prefer `unknown` with narrowing over unsafe casts when input types are not known.
- Keep public APIs and exports well-typed; prefer explicit return types for exported functions.
- Favor small, composable functions with clear types over complex unions or implicit `any`.

## Testing guidelines
- Do not mock, stub, or fake dependencies in unit or e2e tests.
- Use real implementations and providers; keep tests focused and deterministic.
- If behavior changes, update or add tests that exercise the real runtime.

## Workflow guidance
- Run formatting, linting, typecheck, and tests after changes.
- Prefer scoped runs to avoid the entire suite when possible:
  - `pnpm -F <package> lint|typecheck|test|test:e2e`
  - `pnpm turbo run <task> --filter <package>`
- Use `pnpm format` after code edits; keep diffs minimal and intentional.

## Testing notes
- E2E tests are defined for providers (see `packages/providers/*/e2e/`).
- If changing behavior, update or add tests and run the relevant `pnpm test`/`pnpm test:e2e`.

## Formatting and linting
- Lint with `pnpm lint`.
- Format with `pnpm format`.
- Lefthook runs lint/format on commit and typecheck/test on push.

## Changesets and releases
- Add a changeset for user-facing changes: `pnpm changeset`.
- Release flow: `pnpm build` then `changeset publish` (see `pnpm release`).

## Commit messages
- Follow Conventional Commits.
