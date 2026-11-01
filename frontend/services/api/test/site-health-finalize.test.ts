import { describe, expect, it } from 'vitest';
import {
  canonicalIntegrity,
  entitySetEvaluation,
  hreflangConflict,
  sitemapOrphan,
} from '../src/site-health/analysis/finalize.ts';
import {
  aggregateByPageKind,
  aggregateMeasurements,
} from '../src/site-health/analysis/measurement-aggregation.ts';
import {
  contentFingerprint,
  duplicateContent,
  duplicateMatches,
} from '../src/site-health/analysis/duplicate-content.ts';
import {
  canonicalResolution,
  linkRedirects,
  redirectChains,
  resolutionSet,
  type Resolution,
} from '../src/site-health/resolution-evidence.ts';
import { resolveDuplicateAliases } from '../src/site-health/canonical-alias.ts';
import { assessCoverage, type CoverageSignals } from '../src/site-health/coverage.ts';
import { ScoreRefreshCadence } from '../src/site-health/lifecycle.ts';
import { eligibilityState } from '../src/site-health/snapshot-eligibility.ts';

const canonical = (declarations: string[], changes = {}) =>
  canonicalIntegrity({
    declarations,
    finalUrl: 'https://example.test/page',
    targetUrl: 'https://example.test/target',
    checked: true,
    statusCode: 200,
    redirected: false,
    ...changes,
  });

describe('terminal checks from persisted evidence', () => {
  it('distinguishes absent, conflicting, cross-origin and unresolved canonical declarations', () => {
    expect(canonical([]).outcome).toBe('not_applicable');
    expect(canonical(['/a', '/b']).reason_code).toBe('conflicting_declarations');
    expect(canonical(['https://elsewhere.test/a']).reason_code).toBe('cross_origin_canonical');
    expect(canonical(['/a'], { checked: false }).outcome).toBe('unknown');
    expect(canonical(['https://example.test:443/a']).outcome).toBe('satisfied');
  });

  it('fails a canonical whose target redirects, is noindex or names another canonical', () => {
    const target = 'https://example.test/target';
    expect(canonical(['/target'], { redirected: true }).reason_code).toBe(
      'canonical_target_redirects',
    );
    expect(canonical(['/target'], { statusCode: 404 }).reason_code).toBe('canonical_target_error');
    expect(
      canonical(['/target'], { target: { noindex: true, canonical: target } }).reason_code,
    ).toBe('canonical_target_noindex');
    const chain = canonical(['/target'], {
      target: { noindex: false, canonical: 'https://example.test/final' },
    });
    expect([chain.outcome, chain.reason_code, chain.evidence.target_canonical_url]).toEqual([
      'missing',
      'canonical_chain',
      'https://example.test/final',
    ]);
    const direct = canonical(['/target'], { target: { noindex: false, canonical: target } });
    expect([direct.outcome, direct.evidence.target_page_checked]).toEqual(['satisfied', true]);
    // A target fetched but not analyzed is judged on its response alone.
    expect(canonical(['/target']).evidence.target_page_checked).toBe(false);
  });

  it('reads canonical targets, links and chains from persisted redirects', () => {
    const resolution = (changes: Partial<Resolution>): Resolution => ({
      status: 200,
      finalUrl: '',
      redirected: false,
      hops: 0,
      errorCode: '',
      taskId: 'task',
      attemptId: 'attempt',
      artifactId: null,
      ...changes,
    });
    const resolutions = new Map([
      ['https://example.test/', resolution({ finalUrl: 'https://example.test/' })],
      [
        'https://example.test/old',
        resolution({ finalUrl: 'https://example.test/new', redirected: true, hops: 1 }),
      ],
      [
        'https://example.test/older',
        resolution({ finalUrl: 'https://example.test/new', redirected: true, hops: 3 }),
      ],
      ['https://example.test/loop', resolution({ status: 301, errorCode: 'redirect_limit' })],
    ]);
    expect(
      canonicalResolution(['/older'], 'https://example.test/page', resolutions).reason_code,
    ).toBe('canonical_target_redirects');
    // A noindex page naming itself is the indexability check's finding, not a canonical conflict.
    const noindex = new Map([['https://example.test/', { noindex: true, canonical: null }]]);
    expect(canonicalResolution(['/'], 'https://example.test/', resolutions, noindex).outcome).toBe(
      'satisfied',
    );
    expect(
      canonicalResolution(['/'], 'https://example.test/page', resolutions, noindex).reason_code,
    ).toBe('canonical_target_noindex');
    const links = linkRedirects(
      ['https://example.test/', 'https://example.test/old', 'https://example.test/loop'],
      resolutions,
    );
    expect([links.outcome, links.evidence.failing_targets]).toEqual([
      'partial',
      [
        { url: 'https://example.test/old', final_url: 'https://example.test/new', hops: 1 },
        { url: 'https://example.test/loop', reason: 'redirect_limit' },
      ],
    ]);
    // One hop is an ordinary redirect; three hops and a loop are chains to flatten.
    const chains = redirectChains(resolutions);
    expect([
      chains.outcome,
      chains.evidence.redirect_count,
      chains.evidence.failing_targets,
    ]).toEqual([
      'missing',
      3,
      [
        { url: 'https://example.test/loop', reason: 'redirect_limit' },
        { url: 'https://example.test/older', final_url: 'https://example.test/new', hops: 3 },
      ],
    ]);
    expect(redirectChains(new Map([['https://example.test/', resolution({})]])).outcome).toBe(
      'satisfied',
    );
  });

  it('matches exact and near-duplicate main content but not distinct pages', () => {
    const words = (topic: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${topic}${index % 17} word${index}`).join(' ');
    const base = words('garden', 120);
    const pages = new Map(
      Object.entries({
        'https://example.test/a': base,
        'https://example.test/b': base.toUpperCase(),
        'https://example.test/c': `${base} closing`,
        'https://example.test/d': words('invoice', 120),
      }).map(([url, text]) => [url, contentFingerprint(text)!]),
    );
    const matches = duplicateMatches(pages);
    expect(matches.get('https://example.test/a')).toEqual([
      { url: 'https://example.test/b', match: 'exact', distance: 0 },
      { url: 'https://example.test/c', match: 'near', distance: expect.any(Number) },
    ]);
    expect(matches.get('https://example.test/d')).toEqual([]);
    expect(contentFingerprint('Too short to compare.')).toBeNull();
    const flagged = duplicateContent({
      kind: 'compared',
      words: 240,
      compared: 3,
      matches: matches.get('https://example.test/a')!,
    });
    expect([flagged.outcome, flagged.reason_code]).toEqual(['missing', 'exact_duplicate']);
    expect(duplicateContent({ kind: 'excluded', reason: 'canonicalized_elsewhere' }).outcome).toBe(
      'not_applicable',
    );
  });

  it('keeps incomplete target coverage unknown and observed failures actionable', () => {
    expect(entitySetEvaluation('technical.broken_internal_link', 2, 1, []).outcome).toBe('unknown');
    expect(entitySetEvaluation('technical.broken_internal_link', 3, 2, ['/missing']).outcome).toBe(
      'partial',
    );
    expect(sitemapOrphan(1, ['/orphan'], 'partial').outcome).toBe('unknown');
    expect(sitemapOrphan(1, ['/orphan'], 'complete').outcome).toBe('missing');
    expect(
      hreflangConflict({
        alternateCount: 2,
        checkedCount: 1,
        uncheckedCount: 1,
        missingReturnTags: [],
        rateLimitedCount: 1,
      }).reason_code,
    ).toBe('rate_limited_alternates');
  });

  it('retains resolution provenance without treating rate limits as broken URLs', () => {
    const limited: Resolution = {
      status: 429,
      finalUrl: 'https://example.test/a',
      redirected: false,
      hops: 0,
      errorCode: '',
      taskId: 'task-a',
      attemptId: 'attempt-a',
      artifactId: null,
    };
    const resolutions = new Map([['https://example.test/a', limited]]);
    const result = resolutionSet(['https://example.test/a'], resolutions);
    expect(result.outcome).toBe('unknown');
    expect(result.evidence).toMatchObject({
      failing_targets: [],
      resolution_source_ids: ['attempt-a', 'task-a'],
    });
    expect(canonicalResolution(['/a'], 'https://example.test/', resolutions).reason_code).toBe(
      'rate_limited',
    );
    resolutions.set('https://example.test/b', {
      ...limited,
      status: 404,
      taskId: 'task-b',
      attemptId: 'attempt-b',
    });
    expect(resolutionSet([...resolutions.keys()], resolutions).outcome).toBe('missing');
  });

  it('reads a sign-in-gated link as working but a gated sitemap URL as unreachable', () => {
    const resolution = (status: number): Resolution => ({
      status,
      finalUrl: '',
      redirected: false,
      hops: 0,
      errorCode: '',
      taskId: `task-${status}`,
      attemptId: `attempt-${status}`,
      artifactId: null,
    });
    const resolutions = new Map([
      ['https://api.example.test/mcp', resolution(401)],
      ['https://example.test/account', resolution(403)],
      ['https://api.example.test/v1', resolution(404)],
    ]);
    const links = resolutionSet([...resolutions.keys()], resolutions);
    expect(links.evidence.failing_targets).toEqual([
      { url: 'https://api.example.test/v1', status_code: 404 },
    ]);
    const sitemap = resolutionSet(['https://example.test/account'], resolutions, true);
    expect(sitemap.evidence.failing_targets).toEqual([
      { url: 'https://example.test/account', status_code: 403 },
    ]);
  });

  it('counts a robots-denied link as checked, so it never leaves a page’s link checks unknown', () => {
    const resolution = (status: number | null, errorCode = ''): Resolution => ({
      status,
      finalUrl: '',
      redirected: false,
      hops: 0,
      errorCode,
      taskId: `task-${String(status)}`,
      attemptId: `attempt-${String(status)}`,
      artifactId: null,
    });
    // A store footer link to /policies/privacy-policy, which robots.txt disallows.
    const resolutions = new Map([
      ['https://example.test/ok', resolution(200)],
      ['https://example.test/policies/privacy-policy', resolution(null, 'robots_denied')],
      ['https://example.test/timeout', resolution(null, 'timeout')],
    ]);
    const passing = ['https://example.test/ok', 'https://example.test/policies/privacy-policy'];
    const excluded = [
      { url: 'https://example.test/policies/privacy-policy', reason: 'robots_denied' },
    ];
    const links = resolutionSet(passing, resolutions);
    expect(links.outcome).toBe('satisfied');
    expect(links.evidence.excluded_targets).toEqual(excluded);
    const redirects = linkRedirects(passing, resolutions);
    expect(redirects.outcome).toBe('satisfied');
    expect(redirects.evidence.excluded_targets).toEqual(excluded);
    // A target that failed for another reason is still unchecked.
    const timedOut = [...passing, 'https://example.test/timeout'];
    expect(resolutionSet(timedOut, resolutions).outcome).toBe('unknown');
    expect(linkRedirects(timedOut, resolutions).outcome).toBe('unknown');
  });

  it('weights pages equally and keeps missing measurements out of the score denominator', () => {
    const passed = canonical(['/a']);
    const failed = canonical(['/a'], { statusCode: 404 });
    const result = aggregateMeasurements([
      { id: 'a', page_kind: 'article', evaluations: [passed] },
      {
        id: 'b',
        page_kind: 'article',
        evaluations: [failed, { ...passed, rule_id: 'technical.title_present' }],
      },
      { id: 'c', page_kind: 'other', evaluations: [] },
    ]);
    expect(result.web_fundamentals_score).toBe(75);
    expect(result.web_fundamentals_coverage).toBeCloseTo(2 / 3);
    expect(result.web_fundamentals_state).toBe('limited_evidence');
  });

  it('keeps a crawl without site evaluations partial rather than silently measured', () => {
    const indexable = {
      ...canonical(['/a']),
      rule_id: 'technical.indexable',
      outcome: 'satisfied',
      score_roles: ['aeo_readiness'],
      readiness_dimension: 'crawlability',
      readiness_weight: 1,
    };
    const result = aggregateMeasurements([
      { id: 'page', page_kind: 'article', evaluations: [indexable] },
    ]);
    // The answer-crawler verdict was never observed: unknown, so coverage stays partial.
    expect(result.aeo_measurement_state).toBe('limited_evidence');
  });

  it('scores a site-level crawler block on every page, not only the site root', () => {
    const crawlability = {
      ...canonical(['/a']),
      score_roles: ['aeo_readiness'],
      readiness_dimension: 'crawlability',
      readiness_weight: 1,
    };
    const blocked = {
      ...crawlability,
      rule_id: 'technical.ai_crawler_access',
      scope: 'site',
      outcome: 'missing',
    };
    const indexable = { ...crawlability, rule_id: 'technical.indexable', outcome: 'satisfied' };
    const rows = [
      { id: 'root', page_kind: 'homepage', evaluations: [blocked] },
      // Another page records the site rule as not applicable; the root's verdict still applies.
      {
        id: 'page',
        page_kind: 'article',
        evaluations: [indexable, { ...blocked, outcome: 'not_applicable' }],
      },
    ];
    // Root 0 (blocked), page 50 (indexable, blocked); without the site check the page would be 100.
    expect(aggregateMeasurements(rows).aeo_readiness_score).toBe(25);
    // The article subset excludes the root but still carries its site verdict.
    expect(aggregateByPageKind(rows).article!.aeo_readiness_score).toBe(50);
  });
});

const graph = (
  edges: [string, string][],
  active: string[],
  protectedHashes: string[] = [],
  known?: string[],
) => ({
  edges: new Map(edges),
  known: new Set(known ?? [...new Set([...edges.flat(), ...active])]),
  active: new Set(active),
  protectedHashes: new Set(protectedHashes),
});

describe('crawl-wide canonical alias resolution', () => {
  it('excludes every link of a chain in favour of its retained sink', () => {
    expect(
      resolveDuplicateAliases(
        graph(
          [
            ['a', 'b'],
            ['b', 'c'],
          ],
          ['a', 'b', 'c'],
        ),
      ).sort(),
    ).toEqual(['a', 'b']);
  });

  it('keeps one deterministic member of a cycle, preferring a user selection', () => {
    expect(
      resolveDuplicateAliases(
        graph(
          [
            ['a', 'b'],
            ['b', 'a'],
          ],
          ['a', 'b'],
        ),
      ),
    ).toEqual(['b']);
    expect(
      resolveDuplicateAliases(
        graph(
          [
            ['a', 'b'],
            ['b', 'a'],
          ],
          ['a', 'b'],
          ['b'],
        ),
      ),
    ).toEqual(['a']);
  });

  it('never excludes a user selection or aliases toward an unfetched or inactive target', () => {
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a', 'b'], ['a']))).toEqual([]);
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a', 'b'], [], ['a']))).toEqual([]);
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a']))).toEqual([]);
  });
});

const signals = (changes: Partial<CoverageSignals> = {}): CoverageSignals => ({
  sampleMode: false,
  inputMode: 'auto',
  cancelled: false,
  discoveryStatus: 'completed',
  requestedPageLimit: 50,
  frontierLimit: 0,
  admittedUrlCount: 10,
  observationCount: 10,
  pendingFrontierCount: 0,
  discoveryTaskCount: 3,
  failedDiscoveryTaskCount: 0,
  analyzedUrlCount: 10,
  failedUrlCount: 0,
  automaticLimit: 0,
  ...changes,
});

describe('crawl coverage', () => {
  it('is complete only for an exhausted frontier below every limit', () => {
    expect(assessCoverage(signals())).toMatchObject({
      state: 'complete',
      evidence: { reasons: ['frontier_exhausted'] },
    });
  });

  it('is partial when a limit, pending frontier or explicit bound cut discovery short', () => {
    expect(assessCoverage(signals({ admittedUrlCount: 50 })).state).toBe('partial');
    expect(assessCoverage(signals({ pendingFrontierCount: 1 })).state).toBe('partial');
    expect(assessCoverage(signals({ cancelled: true })).evidence.reasons).toEqual([
      'discovery_bounded_or_stopped',
    ]);
    expect(assessCoverage(signals({ inputMode: 'exact_urls' })).state).toBe('partial');
  });

  it('is unknown, not complete, when discovery failed or observed nothing', () => {
    expect(assessCoverage(signals({ failedDiscoveryTaskCount: 1 })).state).toBe('unknown');
    expect(assessCoverage(signals({ observationCount: 0 })).evidence.reasons).toEqual([
      'no_observed_urls',
    ]);
  });
});

describe('search eligibility', () => {
  const satisfied = {
    'acquisition.public_representation': 'satisfied',
    'search.indexability': 'satisfied',
  };
  it('is gated by the critical checkpoints alone', () => {
    expect(
      eligibilityState({ ...satisfied, 'search.crawler_access': 'unknown' }, undefined),
    ).toEqual({ state: 'eligible', status: 'audited' });
    expect(
      eligibilityState({ ...satisfied, 'search.indexability': 'missing' }, undefined).state,
    ).toBe('blocked');
  });

  it('separates a policy exclusion from an unresolved failure and pending work', () => {
    const failed = (error_code: string) => ({ status: 'failed', error_code });
    expect(eligibilityState({}, failed('url_admission_rejected'))).toEqual({
      state: 'excluded',
      status: 'excluded',
    });
    // A robots.txt denial is the site's choice even though acquisition observed the miss.
    expect(
      eligibilityState({ 'acquisition.public_representation': 'missing' }, failed('robots_denied')),
    ).toEqual({ state: 'excluded', status: 'excluded' });
    // A removed page and the page's own noindex are the site's state, not blockers.
    expect(eligibilityState({}, { ...failed('http_4xx'), status_code: 404 })).toEqual({
      state: 'excluded',
      status: 'error',
    });
    expect(eligibilityState({}, { ...failed('http_4xx'), status_code: 403 }).state).toBe('unknown');
    expect(
      eligibilityState({ ...satisfied, 'search.indexability': 'not_applicable' }, undefined),
    ).toEqual({ state: 'excluded', status: 'audited' });
    expect(eligibilityState({}, failed('task_failed'))).toEqual({
      state: 'unknown',
      status: 'error',
    });
    expect(eligibilityState({}, { status: 'queued', error_code: '' })).toEqual({
      state: 'unknown',
      status: 'pending',
    });
  });
});

describe('live score refresh cadence', () => {
  const cadence = (changes = {}) =>
    new ScoreRefreshCadence({
      pageInterval: 10,
      pageFraction: 0.1,
      minIntervalSeconds: 0,
      maxTrackedCrawls: 10,
      ...changes,
    });

  it('refreshes the first analysis, then after a batch that grows with the crawl', () => {
    const gate = cadence();
    const admitted = Array.from({ length: 250 }, () => gate.admits('crawl', 0)).flatMap(
      (due, index) => (due ? [index] : []),
    );
    expect(admitted.slice(0, 3)).toEqual([0, 10, 20]);
    expect(admitted.at(-1)! - admitted.at(-2)!).toBeGreaterThan(10);
  });

  it('refreshes slow progress on elapsed time and every analysis when both triggers are off', () => {
    const slow = cadence({ minIntervalSeconds: 5 });
    slow.admits('crawl', 0);
    expect(slow.admits('crawl', 1000)).toBe(false);
    expect(slow.admits('crawl', 6000)).toBe(true);
    const off = cadence({ pageInterval: 0 });
    expect([off.admits('crawl', 0), off.admits('crawl', 0)]).toEqual([true, true]);
  });
});

it('resolves a canonical declared more than once as the one canonical it names', () => {
  const ok: Resolution = {
    status: 200,
    finalUrl: 'https://example.test/a',
    redirected: false,
    hops: 0,
    errorCode: '',
    taskId: 'task',
    attemptId: 'attempt',
    artifactId: null,
  };
  const result = canonicalResolution(
    ['/a', ' /a '],
    'https://example.test/page',
    new Map([['https://example.test/a', ok]]),
  );
  expect(result.outcome).toBe('satisfied');
});
