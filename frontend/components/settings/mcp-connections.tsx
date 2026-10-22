import { CopyButton } from '@/components/ui/copy-button';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { claudeCodeCommand, MCP_SERVER_URL, mcpServersJson } from '@/lib/config/mcp-clients';

function Snippet({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Stack as="section" gap="compact">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={textRole('itemTitle')}>{label}</h3>
        <CopyButton value={value} variant="ghost" copiedLabel={`${label} copied`}>
          Copy
        </CopyButton>
      </div>
      <pre className="bg-well type-caption overflow-x-auto rounded-[var(--radius-control)] p-3">
        <code>{value}</code>
      </pre>
    </Stack>
  );
}

/**
 * How to connect an MCP client to this install. The server authenticates MCP
 * requests with the static bearer token in its `MCP_TOKEN` environment
 * variable, so there is no per-client grant to list or revoke: rotating the
 * token disconnects every client.
 */
export function McpConnections() {
  return (
    <Stack gap="section">
      <Stack as="section" gap="compact">
        <EditorialSectionHeader
          title="Connect an AI assistant"
          description="Read your CiteLadder data from Claude Code, Claude Desktop, Cursor or any MCP client that speaks streamable HTTP, and make the changes you confirm."
        />
        <p className={textRole('body')}>
          The MCP endpoint is <code>{MCP_SERVER_URL}</code>. Clients authenticate with the bearer
          token set in the server&apos;s <code>MCP_TOKEN</code> environment variable; replace{' '}
          <code>&lt;MCP_TOKEN&gt;</code> below with that value. MCP is off while{' '}
          <code>MCP_TOKEN</code> is unset.
        </p>
      </Stack>
      <Snippet label="Claude Code" value={claudeCodeCommand()} />
      <Snippet label="MCP client configuration" value={mcpServersJson()} />
    </Stack>
  );
}
