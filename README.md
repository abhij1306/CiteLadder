<div align="center">

<img src=".github/assets/social-preview.png" alt="CiteLadder: see how AI answers talk about your brand" width="820" />

# CiteLadder

**Open-source AI search visibility (GEO / AEO) you can self-host.**

Know what ChatGPT, Gemini, Claude and Google AI Overviews tell your buyers. Fix it. Prove it worked.

[![CI](https://github.com/abhij1306/CiteLadder/actions/workflows/ci.yml/badge.svg)](https://github.com/abhij1306/CiteLadder/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/abhij1306/CiteLadder?style=flat-square)](https://github.com/abhij1306/CiteLadder/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/abhij1306/CiteLadder?style=flat-square)](https://github.com/abhij1306/CiteLadder/stargazers)
![Docker Compose](https://img.shields.io/badge/self--host-docker%20compose-2496ED?logo=docker&logoColor=white&style=flat-square)
![MCP server](https://img.shields.io/badge/MCP-server-6E56CF?style=flat-square)

[Why CiteLadder](#why-citeladder) · [Features](#features) · [Quick start](#quick-start) · [MCP](#connect-an-ai-assistant-mcp) · [Hosted version](https://citeladder.com) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Rather not run it yourself?** [CiteLadder Cloud](https://citeladder.com) is the hosted version.

## Screenshots

| AI Visibility | Overview |
|---|---|
| ![AI Visibility: visibility, share of voice, owned citation rate and competitors over time](.github/assets/ai-visibility.png) | ![Project overview with citation share and ranked actions](.github/assets/overview.png) |
| **Site Health** | **Issues** |
| ![Site Health: Web Fundamentals, AEO Readiness and crawl coverage scores](.github/assets/site-health.png) | ![Issues with impact, affected pages and how to fix](.github/assets/issues.png) |

## Why CiteLadder

- **See it.** Which brands AI answers name for your buyers' questions, and which pages they cite.
- **Fix it.** Every finding comes with evidence and a ranked Action.
- **Prove it.** Every prompt is asked several times and compared like for like: real change, not noise.
- **Own it.** Open source and self-hosted. Your data and your keys stay with you.
- **Automate it.** A built-in MCP server lets your own AI assistant read and change your project, with your confirmation.

## Features

- **AI Visibility:** scheduled audits across engines and markets. Visibility, share of voice, citations, competitors, perception and fact checks.
- **Prompts:** buyer questions generated from your site, market and competitors.
- **Site Health:** an AI-aware crawler with scheduled crawls, AEO readiness scores and one-click issue fixes.
- **Issues and Actions:** every problem with its evidence, ranked into a to-do list you can prove out.
- **Agent:** a chat grounded in your data, plus a page workspace that drafts, edits and optimizes content.
- **Commerce:** your product catalog, buyer prompts and how AI shopping answers show your products.
- **Search Demand and Performance:** Google Search Console, GA4 and Bing Webmaster in one view.
- **Search Intelligence:** keyword, volume and backlink research via DataForSEO.
- **AI Traffic:** which AI crawlers read your pages and which answers send you visitors.
- **MCP server and Public API:** work with your project from Claude, ChatGPT or your own code.
- **Reports:** an editable project overview with PDF export.

No publishing to your site, no training on your data. Bring your own model keys; everything runs on your machine.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with Compose v2.

```bash
git clone https://github.com/abhij1306/CiteLadder.git
cd CiteLadder
docker compose up -d --build
```

Open **http://localhost:8100**. No sign-up, no login.

1. **Create a project** from your website.
2. **Add model keys** in *Settings → Providers* to run AI Visibility audits.
3. **Run Site Health.** No keys needed.

Optional settings (the Agent's LLM, MCP token, Google and Microsoft integrations) live in `.env`;
copy `.env.example` to start. Back up the `citeladder_data` volume together with the database.

**Without Docker:** Node.js 26+, pnpm 12 and PostgreSQL 16.

```bash
pnpm bootstrap && pnpm build
DATABASE_URL=postgresql://user:password@localhost:5432/citeladder pnpm start
```

## Connect an AI assistant (MCP)

Set `MCP_TOKEN` in `.env` to a long random string, run `docker compose up -d`, then:

```bash
claude mcp add --transport http citeladder http://localhost:8100/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

*Settings → MCP* shows the snippet for other clients. The bundled [agent plugin](plugins/citeladder)
adds review skills.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
