import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import type { AppEnv } from '../src/context.ts';
import type { Database } from '../src/db/database.ts';
import { registerMcpRoutes } from '../src/mcp/server.ts';
import { authenticateMcp } from '../src/mcp/token-auth.ts';
import { admitToolCall, admitWriteCall } from '../src/mcp/registration.ts';
import { dispatchTool } from '../src/mcp/tools.ts';
import { ApiError } from '../src/errors.ts';
import { appResource } from '../src/mcp/app-resource.ts';

vi.mock('../src/mcp/app-resource.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/mcp/app-resource.ts')>()),
  readAppResource: vi.fn(async () => ({
    contents: [
      {
        uri: 'ui://citeladder/analytics/v1',
        mimeType: 'text/html;profile=mcp-app',
        text: '<!doctype html><div id="root"></div>',
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
      },
    ],
  })),
}));

vi.mock('../src/mcp/token-auth.ts', () => ({ authenticateMcp: vi.fn() }));
// Budgets are PostgreSQL counters.
vi.mock('../src/mcp/registration.ts', () => ({ admitToolCall: vi.fn(), admitWriteCall: vi.fn() }));
// The real catalogue and argument validation; only the database reads are stubbed.
vi.mock('../src/mcp/tools.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mcp/tools.ts')>();
  return { ...actual, dispatchTool: vi.fn(actual.dispatchTool) };
});
const realDispatch = (
  await vi.importActual<typeof import('../src/mcp/tools.ts')>('../src/mcp/tools.ts')
).dispatchTool;
const db = {} as Database;
function app() {
  const config = loadConfig({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
    MCP_TOKEN: process.env.MCP_TOKEN,
    FRONTEND_URL: process.env.FRONTEND_URL,
  });
  const result = new Hono<AppEnv>();
  registerMcpRoutes(result, config, db);
  result.get('/health', (c) => c.text('ok'));
  return result;
}
async function rpc(response: Response) {
  return (await response.json()) as {
    result: Record<string, unknown>;
    error: { code: number; data: unknown };
  };
}
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
function request(
  method: string,
  params: Record<string, unknown> = {},
  modern = false,
  headers: Record<string, string> = {},
) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(modern
        ? {
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': method,
            ...(typeof (params.name ?? params.uri) === 'string'
              ? { 'mcp-name': String(params.name ?? params.uri) }
              : {}),
          }
        : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: modern ? { ...params, _meta: meta } : params,
    }),
  };
}
beforeEach(() => {
  vi.stubEnv('MCP_TOKEN', 'local-token');
  vi.stubEnv('FRONTEND_URL', 'https://app.example.test');
  vi.mocked(authenticateMcp).mockResolvedValue({
    userId: 'user',
    grantId: 'grant',
    workspaceIds: ['workspace'],
    tokenHash: 'hash',
    canWrite: false,
  });
  vi.mocked(dispatchTool).mockResolvedValue({ projects: [{ id: 'project' }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('hosted MCP transport', () => {
  it('advertises the interactive app on its presentation tools on both protocol lifecycles', async () => {
    for (const modern of [false, true]) {
      const service = app();
      const listing = (
        await rpc(
          await service.request(
            'https://protocol.example.test/mcp',
            request('tools/list', {}, modern),
          ),
        )
      ).result;
      // The tool list follows the grant, so it is cacheable only per authorization.
      expect([listing.ttlMs, listing.cacheScope]).toEqual(
        modern ? [3_600_000, 'private'] : [undefined, undefined],
      );
      const listed = listing.tools as Record<string, unknown>[];
      expect(listed.find((tool) => tool.name === 'list_projects')).not.toHaveProperty('_meta');
      expect(listed.find((tool) => tool.name === 'open_analytics')?._meta).toEqual({
        ui: { resourceUri: 'ui://citeladder/analytics/v1' },
      });
      expect(
        (
          await rpc(
            await service.request(
              'https://protocol.example.test/mcp',
              request('resources/list', {}, modern),
            ),
          )
        ).result.resources,
      ).toEqual([appResource]);
      const loaded = await rpc(
        await service.request(
          'https://protocol.example.test/mcp',
          request('resources/read', { uri: appResource.uri }, modern),
        ),
      );
      expect(loaded.result.contents).toEqual([expect.objectContaining({ uri: appResource.uri })]);
      // 2026-07-28 validators require CacheableResult on reads; 2025-11-25 has no such fields.
      expect([loaded.result.ttlMs, loaded.result.cacheScope]).toEqual(
        modern ? [3_600_000, 'public'] : [undefined, undefined],
      );
    }
    expect(dispatchTool).not.toHaveBeenCalled();
    vi.mocked(authenticateMcp).mockResolvedValueOnce(null);
    expect(
      (
        await app().request(
          'https://protocol.example.test/mcp',
          request('resources/read', { uri: appResource.uri }),
        )
      ).status,
    ).toBe(401);
  });
  it('lists and accepts changes only for a grant holding write, each with its own hints', async () => {
    const list = async () =>
      (await rpc(await app().request('https://protocol.example.test/mcp', request('tools/list'))))
        .result.tools as { name: string; annotations: Record<string, boolean> }[];
    const readOnly = await list();
    expect(readOnly.some((tool) => tool.name === 'confirm_change')).toBe(false);
    expect(readOnly.find((tool) => tool.name === 'list_projects')?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const refused = await rpc(
      await app().request(
        'https://protocol.example.test/mcp',
        request('tools/call', { name: 'confirm_change', arguments: { confirmation_token: 'x' } }),
      ),
    );
    expect(refused.error.code).toBe(-32602);

    vi.mocked(authenticateMcp).mockResolvedValue({
      userId: 'user',
      grantId: 'grant',
      workspaceIds: ['workspace'],
      tokenHash: 'hash',
      canWrite: true,
    });
    const hints = Object.fromEntries((await list()).map((tool) => [tool.name, tool.annotations]));
    expect(hints.prepare_archive_prompts).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(hints.create_topic).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(hints.cancel_audit).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
  it('refuses a change over its budget as a tool error with the retry time', async () => {
    vi.mocked(authenticateMcp).mockResolvedValue({
      userId: 'user',
      grantId: 'grant',
      workspaceIds: ['workspace'],
      tokenHash: 'hash',
      canWrite: true,
    });
    vi.mocked(admitWriteCall).mockRejectedValueOnce(
      new ApiError(429, 'Too many changes', { headers: { 'retry-after': '17' } }),
    );
    const refused = await rpc(
      await app().request(
        'https://protocol.example.test/mcp',
        request('tools/call', { name: 'confirm_change', arguments: { confirmation_token: 'x' } }),
      ),
    );
    expect(refused.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Too many changes; retry in 17 seconds' }],
    });
    expect(admitToolCall).toHaveBeenCalledWith(db, 'grant', 'user');
  });
  it('serves legacy initialize and independently accepts modern per-request discovery and tools', async () => {
    const service = app();
    const initialized = await service.request(
      'https://protocol.example.test/mcp',
      request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    );
    expect((await rpc(initialized)).result.protocolVersion).toBe('2025-11-25');
    const discovery = await service.request(
      'https://protocol.example.test/mcp',
      request('server/discover', {}, true),
    );
    expect((await rpc(discovery)).result).toMatchObject({
      resultType: 'complete',
      ttlMs: 3_600_000,
      cacheScope: 'public',
      supportedVersions: ['2026-07-28', '2025-11-25'],
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'citeladder' } },
    });
    const called = await service.request(
      'https://protocol.example.test/mcp',
      request('tools/call', { name: 'list_projects', arguments: {} }, true),
    );
    expect((await rpc(called)).result).toMatchObject({
      resultType: 'complete',
      isError: false,
      structuredContent: { projects: [{ id: 'project' }] },
    });
    expect(dispatchTool).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ tokenHash: 'hash' }),
      'list_projects',
      {},
      'https://app.example.test',
    );
  });
  it('rejects mismatched or missing modern request headers and unsupported versions before tool dispatch', async () => {
    const service = app();
    const mismatches: Record<string, string>[] = [
      { 'mcp-method': 'tools/list' },
      { 'mcp-name': 'fetch' },
      { 'mcp-protocol-version': '2025-11-25' },
    ];
    for (const headers of mismatches) {
      const response = await service.request(
        'https://protocol.example.test/mcp',
        request('tools/call', { name: 'list_projects' }, true, headers),
      );
      expect(response.status).toBe(400);
      expect((await rpc(response)).error.code).toBe(-32020);
    }
    const unsupported = await service.request(
      'https://protocol.example.test/mcp',
      request('tools/list', {}, false, { 'mcp-protocol-version': '2099-01-01' }),
    );
    expect((await rpc(unsupported)).error).toMatchObject({
      code: -32022,
      data: { supported: ['2026-07-28', '2025-11-25'] },
    });
    expect(dispatchTool).not.toHaveBeenCalled();
    const reverse = request('tools/call', { name: 'list_projects' }, true);
    const message = JSON.parse(reverse.body);
    message.params._meta['io.modelcontextprotocol/protocolVersion'] = '2025-11-25';
    reverse.body = JSON.stringify(message);
    expect((await service.request('https://protocol.example.test/mcp', reverse)).status).toBe(400);
    expect(dispatchTool).not.toHaveBeenCalled();
  });
  it('revalidates bearer admission on each request', async () => {
    const service = app();
    expect(
      (await service.request('https://protocol.example.test/mcp', request('tools/list'))).status,
    ).toBe(200);
    vi.mocked(authenticateMcp).mockResolvedValueOnce(null);
    const denied = await service.request(
      'https://protocol.example.test/mcp',
      request('tools/list'),
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toBe('Bearer realm="citeladder"');
  });
  it('refuses a browser request from another origin and admits its own', async () => {
    const service = app();
    const from = (origin: string) =>
      service.request(
        'https://protocol.example.test/mcp',
        request('tools/list', {}, false, { origin }),
      );
    expect((await from('https://evil.example.test')).status).toBe(403);
    expect((await from('https://someone@protocol.example.test')).status).toBe(403);
    expect((await from('https://protocol.example.test')).status).toBe(200);
  });
  it('rejects declared and streamed oversized bodies before bearer or tool handling', async () => {
    const service = app();
    const declared = await service.request(
      'https://protocol.example.test/mcp',
      request('tools/list', {}, false, { 'content-length': '3000000' }),
    );
    expect(declared.status).toBe(413);
    const streamed = await service.request('https://protocol.example.test/mcp', {
      method: 'POST',
      body: 'x'.repeat(3_000_000),
    });
    expect(streamed.status).toBe(413);
    expect(authenticateMcp).not.toHaveBeenCalled();
  });
  it('keeps MCP absent without MCP_TOKEN and unrelated routes healthy', async () => {
    vi.stubEnv('MCP_TOKEN', '');
    const service = app();
    expect(
      (await service.request('https://protocol.example.test/mcp', request('tools/list'))).status,
    ).toBe(404);
    expect((await service.request('/health')).status).toBe(200);
  });
  it('hides server failures but returns a caller mistake as a tool error the model can correct', async () => {
    vi.mocked(dispatchTool).mockRejectedValueOnce(new Error('postgres password secret'));
    const failed = await app().request(
      'https://protocol.example.test/mcp',
      request('tools/call', { name: 'list_projects' }),
    );
    expect((await rpc(failed)).result).toEqual({
      content: [{ type: 'text', text: 'Evidence is unavailable.' }],
      isError: true,
    });
    vi.mocked(dispatchTool).mockRejectedValueOnce(new ApiError(422, 'Unknown sort: volume'));
    const owner = await app().request(
      'https://protocol.example.test/mcp',
      request('tools/call', { name: 'read_performance' }),
    );
    expect((await rpc(owner)).result).toEqual({
      content: [{ type: 'text', text: 'Unknown sort: volume' }],
      isError: true,
    });
    vi.mocked(dispatchTool).mockImplementationOnce(realDispatch);
    const invalid = await app().request(
      'https://protocol.example.test/mcp',
      request('tools/call', { name: 'read_actions', arguments: { project_id: 'x', limit: 0 } }),
    );
    const problem = (await rpc(invalid)).result as {
      content: { text: string }[];
      isError: boolean;
    };
    expect(problem.isError).toBe(true);
    expect(problem.content[0]!.text).toMatch(/project_id/);
    expect(problem.content[0]!.text).toMatch(/limit/);
    const unknown = await app().request(
      'https://protocol.example.test/mcp',
      request('tools/call', { name: 'delete_everything' }),
    );
    expect((await rpc(unknown)).error.code).toBe(-32602);
  });
});
