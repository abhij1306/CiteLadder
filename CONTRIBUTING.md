# Contributing to CiteLadder

Thanks for helping. Bug reports, fixes, features and docs improvements are all welcome.

## Ground rules

- Open an issue before starting a large change, so we can agree on the approach first.
- Keep pull requests focused. One topic per PR is easier to review and to revert.
- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never commit secrets, real customer data or `.env` files.
- Report security problems privately (see [SECURITY.md](SECURITY.md)), not in public issues.

## Development setup

You need Node.js 26+, pnpm 12 (`corepack enable` gives you the pinned version) and a
PostgreSQL 16 database. The easiest database is the one in the Compose file:

```bash
git clone https://github.com/abhij1306/CiteLadder.git
cd CiteLadder
cp .env.example .env                 # optional settings; works as-is for local dev
docker compose up -d db              # PostgreSQL only (localhost:5432 is not published; see below)
pnpm bootstrap                           # installs frontend/ workspace dependencies and git hooks
```

For local development, publish the database port by creating a `docker-compose.override.yml`:

```yaml
services:
  db:
    ports: ['127.0.0.1:5432:5432']
```

Then run the API, the runner and the app dev server in three terminals:

```bash
export DATABASE_URL=postgresql://citeladder:citeladder@127.0.0.1:5432/citeladder
pnpm --dir frontend --filter @citeladder/api migrate             # apply the schema
pnpm --dir frontend --filter @citeladder/api bootstrap:account   # create the local workspace
pnpm --dir frontend --filter @citeladder/api start               # API on http://127.0.0.1:8100
pnpm --dir frontend --filter @citeladder/api tick                # run queued work once (repeat, or loop it)
pnpm dev                                                         # app on http://127.0.0.1:3001, proxies /api to 8100
```

## Repository layout

```text
frontend/apps/app/              the browser app (React + Vite SPA)
frontend/components/, lib/      app UI components and client logic
frontend/services/api/          the API, MCP server, background workers and CLIs (Node, Hono, Kysely)
frontend/services/api/src/config/   tunable product policy (JSON + typed loaders)
frontend/services/api/migrations/   the SQL schema
frontend/packages/contracts/    API contracts shared by the app and the API
frontend/packages/mcp-app/      the MCP Apps view embedded by the MCP server
plugins/citeladder/             a Claude Code / agent plugin with review skills
docker/, Dockerfile             the self-hosted image
```

Node runs the API's TypeScript directly (type stripping), so there is no API build step.

## Making a change

1. Create a branch: `feat/<topic>`, `fix/<topic>`, `docs/<topic>` or `refactor/<topic>`.
2. Extend the existing module that owns the behaviour rather than adding a parallel one.
   Contracts in `frontend/packages/contracts` are the wire format: when you change a response,
   update the API, the contract and the app together.
3. Product policy (limits, thresholds, model settings) lives in `services/api/src/config/`,
   not as constants in code.
4. Schema changes go in a new numbered SQL file in `frontend/services/api/migrations/`
   (`0002_add_thing.sql`, ...); never edit a migration that has shipped, since installs refuse
   a changed one. `migrate` applies pending files on start. Regenerate the
   database types with `pnpm --dir frontend --filter @citeladder/api db:types` (needs `TYPES_DATABASE_URL`).
5. Add or update tests next to the code you changed. Test behaviour the way a user or caller
   sees it, not implementation details.

## Checks

Run what is relevant to your change before opening a PR:

```bash
pnpm lint                                   # oxlint
pnpm format                                 # oxfmt (writes)
pnpm --dir frontend exec vp test run <files>                          # app tests you touched
pnpm --dir frontend --filter @citeladder/api exec vitest run <files>  # API tests you touched
pnpm typecheck                              # app type check
pnpm --dir frontend --filter @citeladder/api typecheck                # API type check
```

API tests that touch the database read `API_TEST_DATABASE_URL`. CI runs the full suites, the
type checks and a Docker build on every pull request.

## Pull requests

- Describe what changed and why, and how you tested it. Screenshots help for UI changes.
- Keep the PR green. If CI fails for a reason unrelated to your change, say so in the PR.
- Use clear commit messages (`fix(site-health): keep crawl delay when robots.txt is missing`).

By contributing, you agree that your contributions are licensed under the
[GNU AGPL v3.0](LICENSE), the project's license.
