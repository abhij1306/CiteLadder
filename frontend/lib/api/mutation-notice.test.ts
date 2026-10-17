import { describe, expect, it } from 'vite-plus/test';

import { ApiError } from './errors';
import { isTransientMutationError, mutationNoticeForError } from './mutation-notice';

const ACTION = { action: 'start the attribution recompute' };

describe('mutationNoticeForError (A4)', () => {
  it('shows the backend message verbatim on a 4xx precondition — no "try again"', () => {
    // COM-6: the flattened "try again" copy was the bug — a non-retryable
    // precondition must read exactly like the backend said.
    const error = new ApiError('no completed sync window is available', 422, '{}', 'req-1', {
      code: 'precondition_failed',
      retryable: false,
    });
    const notice = mutationNoticeForError(error, ACTION);
    expect(notice.message).toBe('no completed sync window is available');
    expect(notice.message).not.toMatch(/try again/i);
    expect(notice.retryable).toBe(false);
    // A6: the machine code + request id ride along for support.
    expect(notice.code).toBe('precondition_failed');
    expect(notice.requestId).toBe('req-1');
  });

  it('shows the backend message verbatim on a 4xx without an envelope too', () => {
    const notice = mutationNoticeForError(new ApiError('Validation failed', 400, '{}'), ACTION);
    expect(notice.message).toBe('Validation failed');
    expect(notice.retryable).toBe(false);
  });

  it('uses transient copy WITH retry on a 5xx', () => {
    const notice = mutationNoticeForError(new ApiError('boom', 500, '{}'), ACTION);
    expect(notice.message).toBe(
      'Could not start the attribution recompute — the request failed or timed out. This is usually temporary; try again.',
    );
    expect(notice.retryable).toBe(true);
  });

  it('uses transient copy WITH retry on a network failure (no status)', () => {
    const notice = mutationNoticeForError(new TypeError('fetch failed'), ACTION);
    expect(notice.retryable).toBe(true);
    expect(notice.message).toMatch(/try again/);
  });

  it('uses transient copy WITH retry on the A3 timeout surface', () => {
    const timeout = new ApiError('timed out', 0, '', 'req-t', {
      code: 'request_timeout',
      retryable: true,
    });
    const notice = mutationNoticeForError(timeout, ACTION);
    expect(notice.retryable).toBe(true);
    expect(notice.code).toBe('request_timeout');
    expect(notice.requestId).toBe('req-t');
  });

  it('honors an explicit retryable classification over the status heuristic', () => {
    const classified = new ApiError('shard rebalancing', 503, '', undefined, {
      retryable: false,
    });
    const notice = mutationNoticeForError(classified, ACTION);
    expect(notice.retryable).toBe(false);
    expect(notice.message).toBe('shard rebalancing');
  });

  it('treats 408/429 as transient even though they are 4xx', () => {
    expect(mutationNoticeForError(new ApiError('slow', 408, '{}'), ACTION).retryable).toBe(true);
    expect(mutationNoticeForError(new ApiError('rate', 429, '{}'), ACTION).retryable).toBe(true);
  });
});

describe('isTransientMutationError', () => {
  it('classifies by status and flag', () => {
    expect(isTransientMutationError(new ApiError('x', 400, '{}'))).toBe(false);
    expect(isTransientMutationError(new ApiError('x', 503, '{}'))).toBe(true);
    expect(isTransientMutationError(new Error('offline'))).toBe(true);
    expect(
      isTransientMutationError(new ApiError('x', 503, '', undefined, { retryable: false })),
    ).toBe(false);
  });
});
