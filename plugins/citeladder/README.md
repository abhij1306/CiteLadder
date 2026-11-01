# CiteLadder plugin

Skills for agents that can talk to CiteLadder's MCP server:

- `ai-visibility-review`: review AI visibility and explain its limits
- `ai-search-change-review`: explain what changed between measured runs
- `technical-seo-triage`: triage Site Health evidence
- `prompt-discovery`: follow the Prompt Builder's steps to generate prompt
  suggestions for review in CiteLadder (uses change tools)

`mcp.json` points at a local instance (`http://localhost:8100/mcp`) and sends
`Authorization: Bearer ${CITELADDER_MCP_TOKEN}`. Set `MCP_TOKEN` in the server's
`.env`, export the same value as `CITELADDER_MCP_TOKEN` where your agent runs,
and change the URL if CiteLadder runs elsewhere.

Read tools never change anything. Change tools (adding prompts, launching
audits, updating Actions) return a preview first, and the skills call
`confirm_change` only after you say yes. Crawls and publishing stay in the app.

The interactive MCP Apps view is built from `frontend/packages/mcp-app`; the
Docker image builds and bundles it.
