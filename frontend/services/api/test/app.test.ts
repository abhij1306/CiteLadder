import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { setLogSink } from '../src/logging.ts';
import { Fixtures, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);

const fixtures = new Fixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('health and readiness', () => {
  it('answers API, public API and MCP requests only for allowed host names', async () => {
    const app = createApp(
      testConfig({
        FRONTEND_URL: 'https://citeladder.example.test',
        ALLOWED_HOSTS: 'proxy.example.test, http://10.0.0.5:8100',
        MCP_TOKEN: 'mcp-test-token',
      }),
      db,
    );
    const status = async (url: string, init?: RequestInit) => (await app.request(url, init)).status;
    for (const host of [
      'localhost:8100',
      '127.0.0.1',
      '[::1]:8100',
      'citeladder.example.test',
      'PROXY.example.test',
      '10.0.0.5:8100',
    ])
      expect(await status(`http://${host}/api/v1/auth/me`)).toBe(200);
    // A rebound attacker name reaches nothing that acts as the local user.
    for (const path of ['/api/v1/auth/me', '/v1/openapi.json', '/mcp'])
      expect(await status(`http://attacker.example${path}`)).toBe(403);
    // Liveness and readiness stay open for container health checks.
    expect(await status('http://attacker.example/health')).toBe(200);
    // `*` opts out of the guard.
    const open = createApp(testConfig({ ALLOWED_HOSTS: '*' }), db);
    expect((await open.request('http://attacker.example/api/v1/auth/me')).status).toBe(200);
  });
  it('reports liveness without touching the database', async () => {
    const response = await createApp(config, db).request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('is ready when PostgreSQL answers', async () => {
    const response = await createApp(config, db).request('/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
  });

  it('leaves rotation when PostgreSQL is unreachable', async () => {
    const unreachable = testConfig({
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:9/none',
      DB_POOL_TIMEOUT_SECONDS: '1',
      DB_CONNECT_TIMEOUT_SECONDS: '1',
    });
    const unreachableDb = testDatabase(unreachable);
    const restore = setLogSink(() => {});
    try {
      const response = await createApp(unreachable, unreachableDb).request('/ready');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable', database: 'down' });
    } finally {
      setLogSink(restore);
      await unreachableDb.destroy();
    }
  });
});

describe('request ids and the error envelope', () => {
  it('rejects oversized API bodies before auth, with declared and streamed lengths', async () => {
    const app = createApp(config, db);
    const bytes = new Uint8Array(policy.api.request_body_max_bytes + 1);
    const declared = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Length': String(bytes.length) },
      body: bytes,
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const streamed = await app.request('/api/v1/projects', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    for (const response of [declared, streamed]) {
      expect(response.status).toBe(413);
      expect(
        response.headers
          .get('cache-control')
          ?.split(',')
          .map((value) => value.trim()),
      ).toContain('no-store');
      expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    }
  });

  it('echoes a safe client request id and replaces an unsafe one', async () => {
    const app = createApp(config, db);
    const kept = await app.request('/health', { headers: { 'X-Request-ID': 'client-id.1' } });
    expect(kept.headers.get('X-Request-ID')).toBe('client-id.1');

    const replaced = await app.request('/health', { headers: { 'X-Request-ID': 'no;way' } });
    expect(replaced.headers.get('X-Request-ID')).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('reads a JSON route body only when it declares application/json', async () => {
    const app = createApp(config, db);
    const post = async (contentType: string | null, body: string) => {
      const response = await app.request('/api/v1/projects', {
        method: 'POST',
        headers: contentType ? { 'Content-Type': contentType } : {},
        body,
      });
      const { error } = (await response.json()) as { error: { code: string } };
      return [response.status, error.code];
    };
    const json = JSON.stringify({ terms_revision: 'r' });
    expect(await post('text/plain', json)).toEqual([415, 'unsupported_media_type']);
    expect(await post('application/x-www-form-urlencoded', 'terms_revision=r')).toEqual([
      415,
      'unsupported_media_type',
    ]);
    expect(await post(null, json)).toEqual([415, 'unsupported_media_type']);
    // A declared JSON body reaches validation, which refuses the missing project fields.
    expect(await post('application/json', json)).toEqual([422, 'validation_error']);
    expect(await post('application/json; charset=utf-8', json)).toEqual([422, 'validation_error']);
  });

  it('answers an unknown path with the coded 404 envelope', async () => {
    const response = await createApp(config, db).request('/nowhere', {
      headers: { 'X-Request-ID': 'trace-404' },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not Found', request_id: 'trace-404', retryable: false },
    });
  });

  it('logs an unhandled failure with its request id and discloses nothing', async () => {
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink((line) => records.push(JSON.parse(line)));
    const app = createApp(config, db);
    app.get('/boom', () => {
      throw new Error('SELECT secret FROM vault');
    });
    try {
      const response = await app.request('/boom', { headers: { 'X-Request-ID': 'trace-500' } });
      expect(response.status).toBe(500);
      expect(response.headers.get('X-Request-ID')).toBe('trace-500');
      const body = (await response.json()) as { error: unknown };
      expect(body.error).toEqual({
        code: 'internal_error',
        message: 'An unexpected error occurred',
        request_id: 'trace-500',
        retryable: true,
      });
      expect(JSON.stringify(body)).not.toContain('vault');
      expect(records).toContainEqual(
        expect.objectContaining({
          event: 'unhandled_api_exception',
          level: 'error',
          correlation_id: 'trace-500',
        }),
      );
    } finally {
      setLogSink(restore);
    }
  });
});
