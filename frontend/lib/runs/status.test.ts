import { describe, expect, it } from 'vite-plus/test';

import {
  auditBadgeValue,
  classificationBadgeValue,
  executionBadgeValue,
  executionFailureReason,
  executionStatusLabel,
  formatDateTime,
  isAuditCancelable,
  schedulePauseReason,
  shouldPollAudit,
} from './status';

describe('audit lifecycle decisions', () => {
  it('keeps polling through reporting and stops at a terminal status', () => {
    expect(shouldPollAudit('reporting')).toBe(true);
    expect(shouldPollAudit('partially_completed')).toBe(false);
  });

  it('cannot cancel a run that is already reporting', () => {
    expect(isAuditCancelable('running')).toBe(true);
    expect(isAuditCancelable('reporting')).toBe(false);
  });
});

describe('badge folding', () => {
  it('folds the extra audit statuses onto the badge space', () => {
    expect(auditBadgeValue('partially_completed')).toBe('partial');
  });

  it('shows a failed execution as a danger and a waiting one as a warning', () => {
    expect(executionBadgeValue('failed')).toBe('danger');
    expect(executionBadgeValue('retry_wait')).toBe('warning');
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
    expect(executionStatusLabel('awaiting_provider_result')).not.toMatch(/undefined/);
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
