import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '@/test/render';

import { McpConnections } from './mcp-connections';

describe('McpConnections', () => {
  it('shows this install’s MCP endpoint with a token placeholder, never a token', () => {
    renderWithProviders(<McpConnections />);

    const endpoint = `${window.location.origin}/mcp`;
    expect(screen.getByText(endpoint)).toBeVisible();
    expect(
      screen.getByText(
        `claude mcp add --transport http citeladder ${endpoint} --header "Authorization: Bearer <MCP_TOKEN>"`,
      ),
    ).toBeVisible();
    // The URL, the Claude Code command and the client configuration.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
  });
});
