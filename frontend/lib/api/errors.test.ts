import { describe, expect, it } from 'vite-plus/test';

import { ApiError, humanizeApiError, httpErrorStatus, isTimeoutError } from './errors';

describe('ApiError', () => {
  it('carries the envelope code / retryable classification when given', () => {
    const error = new ApiError('Nope', 422, '{}', 'req-1', {
      code: 'validation_error',
      retryable: false,
      retryAfterSeconds: 60,
    });
    expect(error.code).toBe('validation_error');
    expect(error.retryable).toBe(false);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.requestId).toBe('req-1');
  });

  it('leaves code / retryable undefined for callers that send no envelope', () => {
    const error = new ApiError('Nope', 404, '{}');
    expect(error.code).toBeUndefined();
    expect(error.retryable).toBeUndefined();
  });
});

describe('humanizeApiError', () => {
  it('projects an ApiError with its status, code, retryable flag, and request id', () => {
    const error = new ApiError('no completed sync window is available', 422, '{}', 'req-9', {
      code: 'precondition_failed',
      retryable: false,
      retryAfterSeconds: 120,
    });
    expect(humanizeApiError(error)).toEqual({
      message: 'no completed sync window is available',
      status: 422,
      code: 'precondition_failed',
      retryable: false,
      retryAfterSeconds: 120,
      requestId: 'req-9',
    });
  });

  it('never surfaces a raw JSON blob stored on the body', () => {
    const error = new ApiError('Bad Request', 400, '{"unexpected":[{"msg":"x"}]}');
    const humanized = humanizeApiError(error);
    expect(humanized.message).toBe('Bad Request');
    expect(humanized.message).not.toContain('{');
  });

  it('falls back when the message is blank', () => {
    expect(humanizeApiError(new ApiError('  ', 500, '')).message).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('uses the Error message for non-API errors', () => {
    expect(humanizeApiError(new Error('offline')).message).toBe('offline');
    expect(humanizeApiError(new Error('  ')).message).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('uses the fallback for non-error values', () => {
    expect(humanizeApiError(undefined).message).toBe('Something went wrong. Please try again.');
    expect(humanizeApiError('nope', 'Custom fallback.').message).toBe('Custom fallback.');
  });

  it('treats a zero status as no status (network-class errors)', () => {
    const timeout = new ApiError('timed out', 0, '', 'req-t', {
      code: 'request_timeout',
      retryable: true,
    });
    const humanized = humanizeApiError(timeout);
    expect(humanized.status).toBeUndefined();
    expect(humanized.retryable).toBe(true);
    expect(httpErrorStatus(timeout)).toBeUndefined();
  });
});

describe('isTimeoutError', () => {
  it('detects AbortSignal.timeout() expiries only', () => {
    expect(isTimeoutError(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true);
    expect(isTimeoutError(new DOMException('Aborted', 'AbortError'))).toBe(false);
    expect(isTimeoutError(new Error('nope'))).toBe(false);
  });
});
