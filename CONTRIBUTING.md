# Contributing

Thanks for your interest in contributing to Universal Sandbox.

## Getting Started

- Install dependencies: `pnpm install`
- Run lint: `pnpm lint`
- Run format: `pnpm format`
- Run typecheck: `pnpm typecheck`
- Run tests: `pnpm test`

## Provider E2E

Provider E2E tests are env-guarded and will skip if credentials are missing.

Run with `pnpm test:providers` (loads `.env.providers` by default).

Required env (by provider/test):

- Daytona: `DAYTONA_API_KEY` (optional: `DAYTONA_API_URL`, `DAYTONA_ORG_ID`)
- Modal: `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_APP_NAME`
- Modal R2 bucket: `MODAL_R2_SECRET` plus the R2 env below
- E2B: `E2B_API_KEY`, `E2B_EMULATED=1`, plus the R2 env below
- Sprites: `SPRITES_TOKEN`, `SPRITES_EMULATED=1`, plus the R2 env below
- Local Docker emulated bucket: `LOCAL_DOCKER_FUSE=1` plus the R2 env below

Shared R2 env:

- `R2_BUCKET`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

## Development Notes

- Providers live under `packages/providers/`.
- The core runtime is in `packages/core/`.
- Use `pnpm -F <package> <script>` to run package-specific scripts.

## Pull Requests

- Keep PRs focused and small.
- Update or add tests when changing behavior.
- Add a changeset for user-facing changes: `pnpm changeset`.
- Ensure `pnpm lint` and `pnpm typecheck` pass.
