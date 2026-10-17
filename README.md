<div align="center">

<img src=".github/assets/social-preview.png" alt="CiteLadder: see how AI answers talk about your brand" width="820" />

# CiteLadder

**Open-source AI search visibility (GEO / AEO) you can self-host.**

See how ChatGPT, Gemini, Claude and Google AI Overviews answer your buyers' questions, which brands
they name, and which pages they cite. Then find out why, fix it, and measure whether it worked.

[![CI](https://github.com/abhij1306/CiteLadder/actions/workflows/ci.yml/badge.svg)](https://github.com/abhij1306/CiteLadder/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/abhij1306/CiteLadder?style=flat-square)](https://github.com/abhij1306/CiteLadder/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/abhij1306/CiteLadder?style=flat-square)](https://github.com/abhij1306/CiteLadder/stargazers)
![Docker Compose](https://img.shields.io/badge/self--host-docker%20compose-2496ED?logo=docker&logoColor=white&style=flat-square)
![MCP server](https://img.shields.io/badge/MCP-server-6E56CF?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-Node%2026-3178C6?logo=typescript&logoColor=white&style=flat-square)

[Quick start](#quick-start) · [Features](#features) · [Screenshots](#screenshots) · [MCP](#connect-an-ai-assistant-mcp) · [Hosted version](https://citeladder.com) · [Docs](https://docs.citeladder.com) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Don't want to run it yourself?** [CiteLadder Cloud](https://citeladder.com) is the hosted
> version with a free trial, team workspaces and managed engine access. Product guides live at
> [docs.citeladder.com](https://docs.citeladder.com).

## What it tracks

For a portfolio of real buyer questions (prompts), CiteLadder asks the answer engines on a schedule
and records every answer:

- **Which answer engines**: ChatGPT, Claude and Gemini through their APIs, plus ChatGPT Search,
  the Gemini app and **Google AI Overviews** through DataForSEO.
- **Which brands they name**: your brand and your competitors, with visibility, share of voice,
  rank and how each one changes between comparable runs.
- **Which pages they cite**: cited and retrieved domains and URLs, your owned citation rate, source
  types, and which publishers show up next to your competitors.
- **What they get wrong**: perception and fact checks against your own site's claims.
- **Why**: your site's crawlability and structure for AI (Site Health), the demand behind each
  question (Search Console, GA4, Bing), and which AI crawlers and referrals actually reach you.

The measured outcome is **observed** mention and citation share, compared under the same prompts and
engines over time. Site and demand metrics are leading indicators, never presented as proof of cause.
`unavailable`, `not configured` and `observed zero` stay three different things.

## Screenshots

| AI Visibility | Overview |
|---|---|
| ![AI Visibility: visibility, share of voice, owned citation rate and competitors over time](.github/assets/ai-visibility.png) | ![Project overview with citation share and ranked actions](.github/assets/overview.png) |
| **Site Health** | **Issues** |
| ![Site Health: Web Fundamentals, AEO Readiness and crawl coverage scores](.github/assets/site-health.png) | ![Issues with impact, affected pages and how to fix](.github/assets/issues.png) |

## Features

| Area | What you get |
|---|---|
| **AI Visibility** | Scheduled audits of your prompt portfolio across engines and markets. Visibility, share of voice, owned citation rate, average position, competitor ranking, trends between comparable runs, cited sources and URLs, perception, accuracy (fact checks), AI ads and query fan-outs. CSV export. |
| **Prompts** | Generate buyer prompts from your site, market and competitors; organise them by topic, intent and buyer stage; review candidates before they are tracked. |
| **Site Health** | A polite, bounded crawler with page-type-aware checks: Web Fundamentals, AEO Readiness by pillar (answerability, structure, evidence, machine readability, provenance, freshness, crawlability), AI crawler access (robots.txt, llms.txt), architecture, internal links and crawl-to-crawl changes. |
| **Issues and Actions** | Every finding with its evidence, affected pages and how to fix it, rolled into a ranked list of Actions you can work through and mark implemented. |
| **Agent** | Ask questions about your project, or start from workflows (articles, landing, comparison and FAQ pages, page refreshes, social posts). Answers are grounded in your evidence with sources, and outputs are reviewable drafts. |
| **Search Demand and Performance** | Google Search Console, GA4 and Bing Webmaster sync, query evidence and landing-page performance. |
| **Search Intelligence** | Keyword suggestions, search volume and backlink research via DataForSEO, with a cost review before any paid call runs. |
| **AI Traffic** | AI crawler logs from Cloudflare (Worker or Logpush), AWS Firehose, Google Cloud Pub/Sub or file uploads, and referral traffic from answer engines: which bots read which pages, and which answers send visitors. |
| **Commerce Suite** | Product catalog, buyer prompts and an AI "shelf" view of how your products appear next to competitors. |
| **MCP server** | 46 tools for Claude, ChatGPT and any MCP client: read visibility, sources, Site Health, actions, demand and traffic, **and make changes**: add or archive prompts, add competitors, launch and schedule audits, update actions. Every change is shown as a preview and applied only after you confirm. Includes an interactive MCP Apps view. |
| **Public API** | Scoped API keys for `/v1` endpoints, with an OpenAPI document at `/v1/openapi.json`. |
| **Overview reports** | An editable project overview with layout control and PDF export. |

CiteLadder never publishes anything to your site for you and never trains on your data. You bring
your own model and data-provider keys, and every crawl and audit runs on your machine.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with Compose v2.

```bash
git clone https://github.com/abhij1306/CiteLadder.git
cd CiteLadder
docker compose up -d --build
```

Open **http://localhost:8100**. The first start builds the image, which takes a few minutes, then
applies the database schema and creates your workspace. There is no sign-up and no login.

Then:

1. **Create a project.** Enter your website; CiteLadder researches the brand and proposes competitors and an ideal customer profile for you to confirm.
2. **Add model keys** in *Settings → Providers* (OpenAI, Anthropic, Google, DataForSEO) to run AI Visibility audits.
3. **Run Site Health** to crawl and analyse your site; it needs no keys.
4. Optionally connect Search Console, GA4 or Bing in *Settings → Integrations* (see [Google and Microsoft sign-in](#google-and-microsoft-integrations)).

To use the Agent, brand research and prompt generation, set an LLM in `.env` (see below) and run
`docker compose up -d` again.

```bash
docker compose logs -f app      # follow the logs
docker compose down             # stop (data is kept in Docker volumes)
docker compose down -v          # stop and delete all data
```

### Without Docker

You need Node.js 26+, pnpm 12 (`corepack enable`) and a PostgreSQL 16 database.

```bash
git clone https://github.com/abhij1306/CiteLadder.git
cd CiteLadder
pnpm bootstrap && pnpm build
DATABASE_URL=postgresql://user:password@localhost:5432/citeladder pnpm start
```

`pnpm start` applies migrations, creates the workspace, serves the app on http://localhost:8100
and runs background jobs. Settings come from the environment or a `.env` file in the repository
root. Generated instance secrets are stored in `.data/`.

## Configuration

Everything is optional. Copy the template and fill in what you need:

```bash
cp .env.example .env
```

| Setting | Purpose |
|---|---|
| `DEFAULT_AGENT_API_KEY`, `DEFAULT_AGENT_BASE_URL`, `DEFAULT_AGENT_MODEL` | The LLM behind the Agent, brand research and prompt generation. Anthropic and OpenAI are fully supported; any OpenAI-compatible endpoint (Gemini, Mistral, or a local server such as Ollama at `http://host.docker.internal:11434/v1`) works for research and generation. |
| `MCP_TOKEN` | Enables the MCP endpoint at `/mcp`; clients send it as a bearer token. |
| `INTEGRATION_GOOGLE_CLIENT_ID` / `_SECRET` | Search Console and GA4 sync (your own Google OAuth client). |
| `INTEGRATION_MICROSOFT_CLIENT_ID` / `_SECRET` | Bing Webmaster sync. |
| `TAVILY_API_KEY`, `KEENABLE_API_KEY` | Optional web research for competitor and brand discovery. |
| `JEV_API_KEY` | Optional quality judge for generated prompt candidates. |
| `CITELADDER_PORT` | Host port for Docker (default `8100`). |
| `PUBLIC_APP_ORIGIN` | The URL you open CiteLadder at, if it is not `http://localhost:8100`. Used in OAuth redirects and MCP setup text. |
| `SITE_HEALTH_*` | Crawler politeness and size limits. |

Answer-engine and DataForSEO keys are entered in the app (*Settings → Providers*) and stored
encrypted in the database. The encryption key and other instance secrets are generated on first
start and kept in the `citeladder_data` volume (or `.data/` without Docker): **back them up
together with the database.**

### Google and Microsoft integrations

Create an OAuth client in your own Google Cloud (or Azure) project, add the redirect URI shown in
*Settings → Integrations*, and put the client ID and secret in `.env`. Without them the
integrations show as *not configured*, and everything else keeps working.

## Connect an AI assistant (MCP)

Set `MCP_TOKEN` in `.env` to a long random string and restart. Then, for example in Claude Code:

```bash
claude mcp add --transport http citeladder http://localhost:8100/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

*Settings → MCP* in the app shows the URL and a JSON snippet for other clients. The bundled
[agent plugin](plugins/citeladder) adds review skills (AI visibility review, change review,
technical SEO triage).

## Security

CiteLadder is a single-workspace, self-hosted tool with **no login**. The Compose file binds the
app to `127.0.0.1` only. Before you expose it to a network, put an authenticating reverse proxy in
front of it. The API also answers only to `localhost` and the host in `PUBLIC_APP_ORIGIN`; list
any other host name you use in `ALLOWED_HOSTS`. See [SECURITY.md](SECURITY.md) for more, and for
how to report vulnerabilities.

## Architecture

```text
browser app (React + Vite SPA) ─┐
MCP clients ────────────────────┼─▶ API (Node 26, Hono) ─▶ PostgreSQL 16 (data + job queue)
public API (/v1) ───────────────┘          ▲
                                           │
                              runner (crawls, audits, syncs, schedules)
```

| Path | What lives there |
|---|---|
| `frontend/apps/app/` | Browser app entry, routes and Vite config |
| `frontend/components/`, `frontend/lib/` | App UI and client logic |
| `frontend/services/api/` | API, MCP server, background workers, CLIs |
| `frontend/services/api/src/config/` | Tunable product policy |
| `frontend/services/api/migrations/` | SQL schema |
| `frontend/packages/contracts/` | API contracts shared by app and API |
| `frontend/packages/mcp-app/` | MCP Apps view |
| `plugins/citeladder/` | Agent plugin with review skills |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, checks and
the PR process, and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network
service, you must offer its source to your users.
