import { afterAll, expect, it } from 'vitest';
import { localAccount } from '../src/auth/local.ts';
import { mcpPolicy } from '../src/mcp/config.ts';
import { authenticateMcp } from '../src/mcp/token-auth.ts';
import { testConfig, testDatabase } from './support.ts';

const config = testConfig({ MCP_TOKEN: 'mcp-auth-test-token' });
const db = testDatabase(config);
afterAll(() => db.destroy());

const bearer = (token: string) =>
  new Request('http://127.0.0.1/mcp', { headers: { authorization: `Bearer ${token}` } });

it('admits MCP_TOKEN as the local user with read access, and nothing else', async () => {
  const { userId, workspaceId } = await localAccount(db);
  const principal = await authenticateMcp(db, config, bearer('mcp-auth-test-token'));
  expect(principal).toMatchObject({ userId, workspaceIds: [workspaceId] });
  const grant = await db
    .selectFrom('mcp_oauth_grants')
    .select(['user_id', 'scopes', 'revoked_at'])
    .where('id', '=', principal!.grantId)
    .executeTakeFirstOrThrow();
  expect(grant).toEqual({
    user_id: userId,
    scopes: mcpPolicy.scopes_supported,
    revoked_at: null,
  });
  expect(await authenticateMcp(db, config, bearer('another-token'))).toBeNull();
  expect(await authenticateMcp(db, config, new Request('http://127.0.0.1/mcp'))).toBeNull();
});

it('is closed when MCP_TOKEN is unset', async () => {
  const closed = testConfig();
  expect(await authenticateMcp(db, closed, bearer(''))).toBeNull();
  expect(await authenticateMcp(db, closed, bearer('mcp-auth-test-token'))).toBeNull();
});
