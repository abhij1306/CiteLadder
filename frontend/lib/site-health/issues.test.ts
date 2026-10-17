import { describe, expect, it } from 'vite-plus/test';

import { issueTitle, severityCount, severityLabel } from './issues';

describe('severity vocabulary', () => {
  it('folds critical into HIGH (three-tier catalog vocabulary)', () => {
    expect(severityLabel('critical')).toBe('HIGH');
  });
});

describe('issueTitle fallback', () => {
  it('uses the title when present', () => {
    expect(issueTitle({ title: 'WebSite schema is missing', rule_id: 'aeo.website' })).toBe(
      'WebSite schema is missing',
    );
  });

  it('falls back to rule_id when the title is blank', () => {
    expect(issueTitle({ title: '   ', rule_id: 'aeo.website' })).toBe('aeo.website');
    expect(issueTitle({ title: '', rule_id: 'technical.canonical' })).toBe('technical.canonical');
  });
});

describe('severityCount', () => {
  it('folds critical into high', () => {
    expect(severityCount({ high: 10, critical: 2 }, 'high')).toBe(12);
  });

  it('reads medium/low directly and defaults missing keys to 0', () => {
    expect(severityCount({ medium: 23 }, 'medium')).toBe(23);
    expect(severityCount({}, 'low')).toBe(0);
    expect(severityCount({ high: 5 }, 'low')).toBe(0);
  });
});
