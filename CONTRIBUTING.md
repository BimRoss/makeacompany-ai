# Contributing

## Local setup

1. Copy `.env.example` to `.env.dev` and set local/test values.
2. Run the app stack:
   - Docker: `docker compose --profile local up --build`
   - Host dev: `./scripts/use-env.sh dev`, then run backend/frontend dev commands.
3. Run checks before opening a PR:
   - `cd backend && go test ./...`
   - `npm run lint`

## Secrets and environment files

- Do not commit real API keys, tokens, or webhook secrets.
- Keep `.env.dev` and `.env.prod` local only (gitignored).
- Only commit placeholder/template updates in `.env.example`.

## Pull request expectations

- Keep PRs focused and include a short test plan.
- Update docs when env vars, auth behavior, or deploy flows change.
- Verify CI passes and that no secret material is present in tracked files.
