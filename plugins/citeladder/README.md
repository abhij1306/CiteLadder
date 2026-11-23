# CiteLadder plugin

Skills for agents that can talk to CiteLadder's MCP server:

- `ai-visibility-review`: review AI visibility and explain its limits
- `ai-search-change-review`: explain what changed between measured runs
- `technical-seo-triage`: triage Site Health evidence

`mcp.json` points at a local instance (`http://localhost:8100/mcp`) and sends
`Authorization: Bearer ${CITELADDER_MCP_TOKEN}`. Set `MCP_TOKEN` in the server's
`.env`, export the same value as `CITELADDER_MCP_TOKEN` where your agent runs,
and change the URL if CiteLadder runs elsewhere.

The MCP server is read-only: no tool changes anything. Changes are made in the CiteLadder app.

The interactive MCP Apps view is built from `frontend/packages/mcp-app`; the
Docker image builds and bundles it.
