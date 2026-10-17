import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { loadMcpConfig } from '../src/mcp/config.ts';

const base = { APP_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1/test' };

it('enables MCP only when MCP_TOKEN is set, and links tool results to the app origin', () => {
  expect(loadMcpConfig(loadConfig(base)).enabled).toBe(false);
  expect(loadMcpConfig(loadConfig({ ...base, MCP_TOKEN: '   ' })).enabled).toBe(false);
  expect(
    loadMcpConfig(
      loadConfig({ ...base, MCP_TOKEN: 'local-token', FRONTEND_URL: 'https://app.example.test/' }),
    ),
  ).toEqual({ enabled: true, token: 'local-token', browserOrigin: 'https://app.example.test' });
});
