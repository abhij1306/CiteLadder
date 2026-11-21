import { describe, expect, it } from 'vite-plus/test';

import { issueTitle, sentences, severityCount } from './issues';

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

describe('sentences', () => {
  it('splits a fix at sentence ends only, never inside a path or a file name', () => {
    expect(
      sentences('Publish /robots.txt for crawlers. Point the link at the final URL!  Then re-run'),
    ).toEqual([
      'Publish /robots.txt for crawlers.',
      'Point the link at the final URL!',
      'Then re-run',
    ]);
    expect(sentences('  ')).toEqual([]);
  });
});
