import { describe, expect, it } from 'vitest';

import type { Crawl } from '../src/site-health/reads/crawl.ts';
import { failureMessage } from '../src/site-health/reads/crawl.ts';
import { resolvePhase } from '../src/site-health/reads/dashboard.ts';
import { issueGroupId, issueImpact } from '../src/site-health/reads/rules.ts';

const CRAWL = '6f1c1d0e-2b7a-4c3e-9a51-0d2f6b8e4a17';

describe('issue group identity', () => {
  it('is the RFC 4122 v5 UUID that links shipped before the move', () => {
    // Reference RFC 4122 v5 values for the same namespace and names.
    expect(issueGroupId(CRAWL, 'technical.title_present', 'defect')).toBe(
      '2b58e280-145a-51cf-9929-b069c0726c43',
    );
    expect(issueGroupId(CRAWL, 'aeo.answer_first', 'advisory')).toBe(
      'a3268e1e-4bfb-5286-b16e-65d69c666aae',
    );
  });
});

describe('issue impact', () => {
  it('bands defects by severity and advisories by their readiness weight', () => {
    expect(issueImpact('technical.indexable', 'defect', 'critical')).toEqual({
      band: 4,
      label: 'Critical',
    });
    expect(issueImpact('unknown.rule', 'advisory', 'medium')).toEqual({
      band: 0,
      label: 'Advisory',
    });
  });
});

describe('screen phase', () => {
  const crawl = (overrides: Partial<Crawl>) =>
    ({ status: 'running', discovery_status: 'running', ...overrides }) as Crawl;
  const measured = { web_fundamentals_state: 'measured', aeo_measurement_state: 'not_measured' };
  const unmeasured = {
    web_fundamentals_state: 'not_measured',
    aeo_measurement_state: 'not_measured',
  };
  const phase = (c: Crawl | null, summary: object | null, monitored = false) =>
    resolvePhase(c, summary as Parameters<typeof resolvePhase>[1], monitored);

  it.each([
    ['no crawl', null, null, false, 'empty'],
    ['a completed crawl', crawl({ status: 'completed' }), null, false, 'dashboard'],
    ['a failed crawl with real scores', crawl({ status: 'failed' }), measured, false, 'dashboard'],
    [
      'a failed crawl with an unscored summary',
      crawl({ status: 'failed' }),
      unmeasured,
      false,
      'terminal',
    ],
    ['a parked crawl', crawl({ status: 'paused' }), null, false, 'terminal'],
    ['an active crawl with a monitored set', crawl({}), null, true, 'analyzing'],
    ['active discovery', crawl({}), null, false, 'discovering'],
    [
      'finished discovery',
      crawl({ discovery_status: 'sample_completed' }),
      null,
      false,
      'analyzing',
    ],
  ] as const)('resolves %s', (_name, c, summary, monitored, expected) => {
    expect(phase(c, summary, monitored)).toBe(expected);
  });
});

describe('root failure message', () => {
  it('names the HTTP status and, for retried 5xx, the attempts', () => {
    expect(failureMessage('http_5xx', 503, 3)).toMatch(/HTTP 503.*after 3 attempts/u);
    const clientFailure = failureMessage('http_4xx', 404, 2);
    expect(clientFailure).toContain('HTTP 404');
    expect(clientFailure).not.toContain('attempts');
    expect(failureMessage('timeout', null, 2)).toMatch(/time.*after 2 attempts/u);
    expect(failureMessage('', null, null)).toMatch(/failed.*start URL/u);
  });
});
