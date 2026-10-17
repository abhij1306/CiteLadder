import { describe, expect, it } from 'vite-plus/test';

import type { DemandSignal } from '@/lib/api/demand';
import { parseAgentHandoff } from '@/lib/agent/handoff';
import {
  competingPages,
  demandSignalHandoffHref,
  detectorStates,
  safePageUrl,
  signalPageLine,
  signalTarget,
} from './signals';

/** `evidence`/`metrics` are `Record<string, unknown>` on the wire, so these
 * helpers are the boundary that makes them safe to render. */
function signal(overrides: Partial<DemandSignal> = {}): DemandSignal {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    snapshot_id: '22222222-2222-4222-8222-222222222222',
    signal_type: 'query_cannibalization',
    state: 'active',
    topic_cluster: 'cluster',
    page_url: '',
    evidence: {},
    metrics: {},
    coverage: {},
    limitations: [],
    priority_score: null,
    priority_inputs: {},
    created_at: '2026-07-08T00:00:00Z',
    action_id: null,
    ...overrides,
  } as DemandSignal;
}

describe('safePageUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(safePageUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safePageUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('rejects unsafe and non-absolute values', () => {
    expect(safePageUrl('javascript:alert(1)')).toBeNull();
    expect(safePageUrl('data:text/html,<script>')).toBeNull();
    // Protocol-relative URLs inherit the app's scheme and would pass a
    // post-parse protocol check while navigating off-site.
    expect(safePageUrl('//evil.example/x')).toBeNull();
    expect(safePageUrl('/relative/path')).toBeNull();
    expect(safePageUrl('')).toBeNull();
    expect(safePageUrl(null)).toBeNull();
  });
});

describe('competingPages', () => {
  it('keeps only fully-formed entries', () => {
    const pages = competingPages(
      signal({
        evidence: {
          pages: [
            { url: 'https://a.example', impressions: 10, share: 0.5 },
            { url: 'https://b.example' }, // missing metrics
            { url: 'https://c.example', impressions: 'lots', share: 0.5 },
            { impressions: 4, share: 0.1 }, // missing url
            null,
          ],
        },
      }),
    );
    expect(pages).toEqual([{ url: 'https://a.example', impressions: 10, share: 0.5 }]);
  });

  it('returns an empty list when evidence carries no pages array', () => {
    expect(competingPages(signal())).toEqual([]);
    expect(competingPages(signal({ evidence: { pages: 'nope' } }))).toEqual([]);
  });
});

describe('detectorStates', () => {
  it('normalises limitations to an array so callers can join it', () => {
    const states = detectorStates({
      detectors: {
        striking_distance: { state: 'available', limitations: 'not an array' },
        cannibalization: { state: 'partial', limitations: ['one', 2, 'three'] },
        query_trends: { state: 42 },
      },
    });
    expect(states.striking_distance?.limitations).toEqual([]);
    expect(states.cannibalization?.limitations).toEqual(['one', 'three']);
    // A non-string state is dropped so the caller's default applies.
    expect(states.query_trends!.state).toBeUndefined();
  });

  it('ignores a summary whose detectors field is not an object map', () => {
    expect(detectorStates({})).toEqual({});
    expect(detectorStates({ detectors: ['a'] })).toEqual({});
    expect(detectorStates({ detectors: 'available' })).toEqual({});
  });
});

describe('signalTarget', () => {
  it('falls back through cluster and URL when target is absent or not a string', () => {
    expect(signalTarget(signal({ evidence: { target: 'query text' } }))).toBe('query text');
    expect(signalTarget(signal({ evidence: { target: 42 } }))).toBe('cluster');
    expect(signalTarget(signal({ topic_cluster: '', page_url: 'https://x.example' }))).toBe(
      'https://x.example',
    );
  });
});

describe('demandSignalHandoffHref', () => {
  const handoff = (value: DemandSignal) =>
    parseAgentHandoff(new URL(demandSignalHandoffHref(value), 'http://x').searchParams);

  it('carries the signal id and its safe page as typed references', () => {
    const value = signal({ page_url: 'https://example.com/a', evidence: { target: 'crm tools' } });
    expect(handoff(value).context).toEqual({
      demand_signal_id: value.id,
      target_url: 'https://example.com/a',
    });
    expect(handoff(value).prompt).toContain('"crm tools"');
  });

  it('drops a page URL that is not safe to link', () => {
    expect(handoff(signal({ page_url: 'javascript:alert(1)' })).context).toEqual({
      demand_signal_id: signal().id,
    });
  });
});

describe('signalPageLine', () => {
  it('names a query signal’s landing page by path, and gives a page signal no second line', () => {
    const pricing = 'https://example.com/pricing?plan=team';

    expect(
      [
        signal({ page_url: pricing, evidence: { target: 'crm pricing' } }),
        signal({ page_url: 'example.com/legacy', evidence: { target: 'crm legacy' } }),
        signal({ page_url: '', evidence: { target: 'crm tools' } }),
        signal({ page_url: '', evidence: { target_kind: 'page', target: pricing } }),
      ].map(signalPageLine),
    ).toEqual(['/pricing?plan=team', 'example.com/legacy', null, null]);
  });
});
