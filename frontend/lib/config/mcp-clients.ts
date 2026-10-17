import { API_HOST_ORIGIN } from './api-host';

/**
 * The MCP endpoint of this install. The API authenticates MCP clients with the
 * static bearer token in the server's `MCP_TOKEN` environment variable; the
 * browser never sees that value, so the snippets carry a placeholder.
 */
export const MCP_SERVER_URL = `${API_HOST_ORIGIN}/mcp`;

const MCP_TOKEN_PLACEHOLDER = '<MCP_TOKEN>';

/** `claude mcp add` for Claude Code. */
export function claudeCodeCommand(serverUrl: string = MCP_SERVER_URL): string {
  return `claude mcp add --transport http citeladder ${serverUrl} --header "Authorization: Bearer ${MCP_TOKEN_PLACEHOLDER}"`;
}

/** The `mcpServers` entry most HTTP-capable MCP clients accept. */
export function mcpServersJson(serverUrl: string = MCP_SERVER_URL): string {
  return JSON.stringify(
    {
      mcpServers: {
        citeladder: {
          type: 'http',
          url: serverUrl,
          headers: { Authorization: `Bearer ${MCP_TOKEN_PLACEHOLDER}` },
        },
      },
    },
    null,
    2,
  );
}
