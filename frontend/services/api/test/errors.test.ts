import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { ApiError, onError } from '../src/errors.ts';

describe('HTTP error decisions', () => {
  it.each([
    [409, 'conflict', false],
    [408, 'http_error', true],
    [429, 'rate_limited', true],
    [503, 'service_unavailable', true],
  ] as const)(
    'translates a framework %s into a coded retry decision',
    async (status, code, retryable) => {
      const app = new Hono();
      app.onError(onError);
      app.get('/', () => {
        throw new HTTPException(status, { message: 'Request failed' });
      });
      const response = await app.request('/');
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code, retryable } });
    },
  );

  it('keeps explicit domain codes and retry overrides at the HTTP boundary', async () => {
    const app = new Hono();
    app.onError(onError);
    app.get('/', () => {
      throw new ApiError(503, 'Review expired', {
        code: 'review_expired',
        retryable: false,
        details: { expired: true },
      });
    });
    const response = await app.request('/');
    expect(await response.json()).toMatchObject({
      error: { code: 'review_expired', retryable: false, details: { expired: true } },
    });
  });

  it('rejects unknown machine codes from untyped persisted or provider values', () => {
    expect(() => asApiErrorCode('undeclared_provider_code')).toThrow(
      'not a declared API error code',
    );
  });
});
