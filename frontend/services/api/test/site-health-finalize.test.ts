import { describe, expect, it } from 'vitest';
import {
  canonicalIntegrity,
  entitySetEvaluation,
  hreflangConflict,
  sitemapOrphan,
  sitemapPresent,
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
  sitewideLinks,
  sitewideTargets,
  type Resolution,
} from '../src/site-health/resolution-evidence.ts';
import { compareText } from '../src/text-order.ts';
import { resolveDuplicateAliases } from '../src/site-health/canonical-alias.ts';
import { assessCoverage, type CoverageSignals } from '../src/site-health/coverage.ts';
import { RefreshCadence } from '../src/site-health/refresh-cadence.ts';
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
    expect(matches('https://example.test/a')).toEqual([
      { url: 'https://example.test/b', match: 'exact', distance: 0 },
      { url: 'https://example.test/c', match: 'near', distance: expect.any(Number) },
    ]);
    expect(matches('https://example.test/d')).toEqual([]);
    expect(contentFingerprint('Too short to compare.')).toBeNull();
    const flagged = duplicateContent({
      kind: 'compared',
      words: 240,
      compared: 3,
      matches: matches('https://example.test/a'),
    });
    expect([flagged.outcome, flagged.reason_code]).toEqual(['missing', 'exact_duplicate']);
    const print = (url: string, flips: number[]) => {
      let [low, high] = [0x1234_5678, 0x9abc_def0];
      for (const bit of flips)
        if (bit < 32) low ^= 1 << bit;
        else high ^= 1 << (bit - 32);
      return [url, { exact: url, words: 60, low: low >>> 0, high: high >>> 0 }] as const;
    };
    const copies = Array.from({ length: 12 }, (_, at) => `https://example.test/copy-${at + 10}`);
    const banded = duplicateMatches(
      new Map([
        print('https://example.test/base', []),
        print('https://example.test/three', [1, 20, 40]),
        print('https://example.test/four', [2, 21, 41, 60]),
        ...copies.map((url) => [url, { ...print(url, [])[1], exact: 'copy' }] as const),
      ]),
    );
    expect(
      banded('https://example.test/three').map((match) => [match.url, match.distance]),
    ).toEqual([['https://example.test/base', 3], ...copies.slice(0, 9).map((url) => [url, 3])]);
    expect(banded('https://example.test/copy-10').slice(0, 2)).toEqual([
      { url: 'https://example.test/copy-11', match: 'exact', distance: 0 },
      { url: 'https://example.test/copy-12', match: 'exact', distance: 0 },
    ]);
    expect(banded('https://example.test/four').map((match) => match.url)).toEqual([]);
    expect(duplicateContent({ kind: 'excluded', reason: 'canonicalized_elsewhere' }).outcome).toBe(
      'not_applicable',
    );
  });

  it('raises "No sitemap" only for a full crawl whose setup read no sitemap document', () => {
    const outcome = (sampleMode: boolean, sitemap: Record<string, unknown>) =>
      sitemapPresent({ sampleMode, sitemap }).outcome;
    expect(outcome(false, { fetched: false, file_count: 0, unread_count: 0 })).toBe('missing');
    expect(outcome(false, { fetched: false, file_count: 0, unread_count: 1 })).toBe('unknown');
    expect(
      sitemapPresent({ sampleMode: false, sitemap: { fetched: true, file_count: 2 } }),
    ).toMatchObject({
      outcome: 'satisfied',
      evidence: { sitemap_file_count: 2 },
    });
    expect(outcome(true, { fetched: false, file_count: 0 })).toBe('not_applicable');
    expect(outcome(false, { fetched: false, file_count: 0, pending: true })).toBe('unknown');
    expect(outcome(false, {})).toBe('unknown');
  });

  it('keeps incomplete target coverage unknown and observed failures actionable', () => {
    const unchecked = entitySetEvaluation('technical.broken_internal_link', 2, 1, []);
    expect([unchecked.outcome, unchecked.reason_code]).toEqual(['unknown', 'unchecked_targets']);
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
    const sitemap = resolutionSet(['https://example.test/account'], resolutions, { sitemap: true });
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
    const timedOut = [...passing, 'https://example.test/timeout'];
    expect(resolutionSet(timedOut, resolutions).outcome).toBe('unknown');
    expect(linkRedirects(timedOut, resolutions).outcome).toBe('unknown');
  });

  it('judges a link most pages share once on the root, keyed by the link, not on every page', () => {
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
    const url = (path: string) => `https://example.test${path}`;
    // A store whose one footer link 301s, on every page.
    const resolutions = new Map([
      [url('/'), resolution({ finalUrl: url('/') })],
      [
        url('/collections/screens'),
        resolution({
          finalUrl: url('/collections/outdoor/'),
          redirected: true,
          hops: 1,
          taskId: 'task-screens',
          attemptId: 'attempt-screens',
        }),
      ],
      [url('/gone'), resolution({ status: 404, taskId: 'task-gone', attemptId: 'attempt-gone' })],
      [url('/old-product'), resolution({ finalUrl: url('/product'), redirected: true, hops: 1 })],
    ]);
    const footer = [url('/'), url('/collections/screens'), url('/gone')];
    const pages = Array.from({ length: 6 }, (_, index) => `/p${index}`);
    const linksByPage = [[...footer, url('/old-product')], ...pages.slice(1).map(() => footer)];
    expect(
      [...sitewideTargets([...linksByPage, [url('/old-product')]])].toSorted(compareText),
    ).toEqual([url('/'), url('/collections/screens'), url('/gone')]);
    const sitewide = sitewideTargets(linksByPage);
    expect(sitewideTargets(linksByPage.slice(0, 4))).toEqual(new Set());

    const redirects = linkRedirects(linksByPage[0]!, resolutions, sitewide);
    expect([redirects.outcome, redirects.evidence.failing_targets]).toEqual([
      'partial',
      [{ url: url('/old-product'), final_url: url('/product'), hops: 1 }],
    ]);
    expect(redirects.evidence.sitewide_targets).toEqual([
      { url: url('/collections/screens'), final_url: url('/collections/outdoor/'), hops: 1 },
    ]);
    const onlyShared = linkRedirects(linksByPage[1]!, resolutions, sitewide);
    expect([onlyShared.outcome, onlyShared.evidence.failing_targets]).toEqual(['satisfied', []]);
    const broken = resolutionSet(linksByPage[1]!, resolutions, { sitewide });
    expect([broken.outcome, broken.evidence.sitewide_targets]).toEqual([
      'satisfied',
      [{ url: url('/gone'), status_code: 404 }],
    ]);

    const linkers = new Map(
      footer.map((target) => [
        target,
        pages.map((path) => ({
          siteUrlId: `site-${path}`,
          url: url(path),
          title: `Page ${path}`,
          pageKind: path === '/p0' ? 'homepage' : 'product',
          artifactId: `artifact-${path}`,
        })),
      ]),
    );
    const [brokenShared, redirectShared] = sitewideLinks(sitewide, linkers, resolutions);
    expect([brokenShared!.rule_id, brokenShared!.outcome, brokenShared!.scope]).toEqual([
      'technical.sitewide_broken_link',
      'missing',
      'site',
    ]);
    expect(redirectShared!.evidence).toMatchObject({
      count: 6,
      linking_page_kinds: ['homepage', 'product'],
      page_kind_counts: { homepage: 1, product: 5 },
      resolution_source_ids: ['attempt-screens', 'task-screens'],
    });
    const [target] = redirectShared!.evidence.targets as Record<string, unknown>[];
    expect(target).toMatchObject({
      url: url('/collections/screens'),
      final_url: url('/collections/outdoor/'),
      hops: 1,
      linking_page_count: 6,
    });
    expect((target!.pages as unknown[])[0]).toEqual({
      site_url_id: 'site-/p0',
      url: url('/p0'),
      title: 'Page /p0',
      page_kind: 'homepage',
      artifact_id: 'artifact-/p0',
    });
    expect(
      sitewideLinks(new Set([url('/')]), linkers, resolutions).map((row) => row.outcome),
    ).toEqual(['satisfied', 'satisfied']);
    resolutions.set(url('/busy'), resolution({ status: 429 }));
    expect(
      sitewideLinks(new Set([url('/'), url('/never'), url('/busy')]), linkers, resolutions).map(
        (row) => [row.outcome, row.evidence.unchecked_targets],
      ),
    ).toEqual([
      ['unknown', [url('/busy'), url('/never')]],
      ['unknown', [url('/busy'), url('/never')]],
    ]);
  });

  it('weights pages equally and counts an applicable page with no check run as 0', () => {
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
    expect(result.web_fundamentals_score).toBe(15);
    expect(result.web_fundamentals_checks).toEqual({ run: 3, total: 12 });
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
      {
        id: 'page',
        page_kind: 'article',
        evaluations: [indexable, { ...blocked, outcome: 'not_applicable' }],
      },
    ];
    expect(aggregateMeasurements(rows).aeo_readiness_score).toBeCloseTo(10);
    expect(aggregateByPageKind(rows).article!.aeo_readiness_score).toBeCloseTo(20);
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

  it('never excludes a protected page or aliases toward an unfetched or inactive target', () => {
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a', 'b'], ['a']))).toEqual([]);
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a', 'b'], [], ['a']))).toEqual([]);
    expect(resolveDuplicateAliases(graph([['a', 'b']], ['a']))).toEqual([]);
  });
});

const signals = (changes: Partial<CoverageSignals> = {}): CoverageSignals => ({
  sampleMode: false,
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

  it('is complete when a site with exactly the requested page limit exhausted its frontier', () => {
    expect(assessCoverage(signals({ admittedUrlCount: 50 }))).toMatchObject({
      state: 'complete',
      evidence: { reasons: ['frontier_exhausted'] },
    });
  });

  it('covers a sitemap crawl only when it read the whole sitemap and audits every URL it lists', () => {
    const sitemap = (discovered: number, tracked: number, short = {}) =>
      assessCoverage(
        signals({
          discoveryTaskCount: 0,
          sitemap: { discovered, tracked, limitReached: false, unreadDocuments: 0, ...short },
        }),
      );
    expect(sitemap(3, 3)).toMatchObject({
      state: 'complete',
      evidence: { reasons: ['sitemap_exhausted'] },
    });
    expect(sitemap(10, 3).evidence.reasons).toEqual(['tracked_pages_below_site']);
    expect(sitemap(3, 3, { limitReached: true }).evidence.reasons).toEqual([
      'sitemap_limit_reached',
    ]);
    expect(sitemap(3, 3, { unreadDocuments: 1 }).evidence.reasons).toEqual([
      'sitemap_documents_unread',
    ]);
  });

  it('is partial when a limit, pending frontier or explicit bound cut discovery short', () => {
    expect(
      assessCoverage(signals({ admittedUrlCount: 50, pendingFrontierCount: 4 })).evidence.reasons,
    ).toEqual(['requested_page_limit_reached', 'frontier_not_exhausted']);
    expect(assessCoverage(signals({ pendingFrontierCount: 1 })).state).toBe('partial');
    expect(assessCoverage(signals({ cancelled: true })).evidence.reasons).toEqual([
      'discovery_bounded_or_stopped',
    ]);
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
    expect(
      eligibilityState({ 'acquisition.public_representation': 'missing' }, failed('robots_denied')),
    ).toEqual({ state: 'excluded', status: 'excluded' });
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
    new RefreshCadence({
      pageInterval: 10,
      pageFraction: 0.1,
      minIntervalSeconds: 0,
      largePages: 0,
      largeIntervalSeconds: 0,
      maxTrackedCrawls: 10,
      ...changes,
    });

  it('refreshes the first analysis, then after a batch that grows with the crawl', () => {
    const gate = cadence();
    const admitted = Array.from({ length: 250 }, () => gate.admits('crawl', { now: 0 })).flatMap(
      (due, index) => (due ? [index] : []),
    );
    expect(admitted.slice(0, 3)).toEqual([0, 10, 20]);
    expect(admitted.at(-1)! - admitted.at(-2)!).toBeGreaterThan(10);
  });

  it('refreshes slow progress on elapsed time and every analysis when both triggers are off', () => {
    const slow = cadence({ minIntervalSeconds: 5 });
    slow.admits('crawl', { now: 0 });
    expect(slow.admits('crawl', { now: 1000 })).toBe(false);
    expect(slow.admits('crawl', { now: 6000 })).toBe(true);
    const off = cadence({ pageInterval: 0 });
    expect([off.admits('crawl', { now: 0 }), off.admits('crawl', { now: 0 })]).toEqual([
      true,
      true,
    ]);
  });

  it('waits the longer interval once the crawl reaches the large-crawl size', () => {
    const gate = cadence({
      pageInterval: 0,
      minIntervalSeconds: 30,
      largePages: 2000,
      largeIntervalSeconds: 120,
    });
    gate.admits('small', { now: 0, pages: 1999 });
    gate.admits('large', { now: 0, pages: 2000 });
    expect(gate.admits('small', { now: 31_000, pages: 1999 })).toBe(true);
    expect(gate.admits('large', { now: 31_000, pages: 2000 })).toBe(false);
    expect(gate.admits('large', { now: 121_000, pages: 2000 })).toBe(true);
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
