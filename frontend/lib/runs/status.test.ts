import { describe, expect, it } from 'vite-plus/test';

import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';

import {
  AUDIT_STATES,
  EXECUTION_STATES,
  classificationBadgeValue,
  executionFailureReason,
  executionStatusLabel,
  formatDateTime,
  pollAudits,
  schedulePauseReason,
} from './status';

describe('audit lifecycle decisions', () => {
  it('keeps polling while any run is reporting and stops once all are terminal', () => {
    expect(pollAudits(['completed', 'reporting'])).toBe(ACTIVE_RUN_POLL_MS);
    expect(pollAudits(['completed', 'partially_completed'])).toBe(false);
    expect(pollAudits(undefined)).toBe(false);
  });
});

describe('badge folding', () => {
  it('folds the extra audit statuses onto the badge space', () => {
    expect(AUDIT_STATES.partially_completed.badge).toBe('partial');
  });

  it('shows a failed execution as a danger and a waiting one as a warning', () => {
    expect(EXECUTION_STATES.failed.badge).toBe('danger');
    expect(EXECUTION_STATES.retry_wait.badge).toBe('warning');
  });

  it('folds unintended owned citations onto the owned visual', () => {
    expect(classificationBadgeValue('unintended')).toBe('owned');
  });
});

describe('executionStatusLabel', () => {
  it('names the engine being waited on, and falls back without one', () => {
    expect(executionStatusLabel('awaiting_provider_result', 'ChatGPT search')).toContain(
      'ChatGPT search',
    );
    expect(executionStatusLabel('awaiting_provider_result')).toBe('Waiting for the provider');
  });
});

describe('failure and pause reasons', () => {
  it('explains a known failure code and never leaks an unknown token', () => {
    expect(executionFailureReason('rate_limit')).not.toBe(executionFailureReason('weird_new_code'));
    const generic = executionFailureReason('weird_new_code');
    expect(generic).not.toContain('weird_new_code');
    expect(generic.length).toBeGreaterThan(0);
  });

  it('explains a schedule pause with a fallback for an unknown code', () => {
    expect(schedulePauseReason('execution_credentials_unavailable')).not.toBe(
      schedulePauseReason('weird_new_code'),
    );
    expect(schedulePauseReason('weird_new_code')).not.toContain('weird_new_code');
  });
});

describe('formatDateTime', () => {
  it('renders a placeholder for null and echoes an unparseable value', () => {
    expect(formatDateTime(null)).toBe('Unknown');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
