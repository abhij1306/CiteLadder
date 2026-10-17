import { describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import {
  searchGapDecisions,
  type GapInputs,
  type GapRow,
  type SearchGapSource,
} from '../src/opportunities/search-gap-hits.ts';

const g = policy.opportunity.opportunities.SEARCH_GAP;
const competitor = (id: string, name: string) => ({ id, name, domain: `${id}.test` });
const dataset = (id: string, who: ReturnType<typeof competitor>, coverage = 'complete') => ({
  id,
  competitor: who,
  target_origin: 'https://www.example.com',
  coverage,
  truncated: false,
  published_at: '2026-10-01T00:00:00Z',
});
const rival = competitor('rival', 'Rival'),
  other = competitor('other', 'Other Co');
const source: SearchGapSource = {
  revision: 'r',
  market: { location_code: 2840, language_code: 'en' },
  datasets: [dataset('d1', rival), dataset('d2', other)],
  ranked_dataset_ids: [],
  competitors: [rival, other],
};
let next = 0;
const row = (keyword: string, values: Partial<GapRow> = {}): GapRow => ({
  id: `row-${next++}`,
  dataset_id: 'd1',
  keyword,
  search_volume: 500,
  rank_group: 3,
  intent: 'commercial',
  url: 'https://rival.test/page',
  ...values,
});
const inputs = (rows: GapRow[], extra: Partial<GapInputs> = {}): GapInputs => ({
  source,
  rows,
  rows_truncated: false,
  ranked: new Set(),
  branded: new Set(),
  search_console: new Set(),
  pages: [],
  ...extra,
});

describe('keyword-gap decisions', () => {
  it('abstains on unknown values and leaves known searches to their owners', () => {
    const { hits, limitations } = searchGapDecisions(
      inputs(
        [
          row('hiking poles', { search_volume: null }),
          row('trail boots', { search_volume: g.MIN_SEARCH_VOLUME - 1 }),
          row('camp stoves', { rank_group: null }),
          row('tent pegs', { rank_group: g.MAX_COMPETITOR_RANK + 1 }),
          row('rival login', { intent: 'navigational' }),
          row('rival alternatives'),
          row('example store'),
          row('running shoes'),
          row('trail shoes'),
        ],
        {
          branded: new Set(['example store']),
          ranked: new Set(['running shoes']),
          search_console: new Set(['trail shoes']),
        },
      ),
    );
    expect(hits).toEqual([]);
    expect(limitations.at(-1)).toContain('1 unknown volume');
    expect(limitations.at(-1)).toContain('1 competitor named');
    expect(limitations.at(-1)).toContain('1 already ranking');
    expect(limitations.at(-1)).toContain('1 search console');
  });

  it('merges one search across competitors and word orders, and ranks it higher', () => {
    const { hits } = searchGapDecisions(
      inputs([
        row('running shoes', { search_volume: 900 }),
        row('shoes running', { dataset_id: 'd2', search_volume: 100 }),
        row('trail socks', { search_volume: 900 }),
      ]),
    );
    expect(hits.map((hit) => hit.target_theme)).toEqual(['running shoes', 'trail socks']);
    const [merged, single] = hits;
    expect(merged!.evidence.competitor_names).toEqual(['Other Co', 'Rival']);
    expect(merged!.gap_factor).toBeGreaterThan(single!.gap_factor);
    expect(merged!.value_factor).toBe(single!.value_factor);
  });

  it('targets the one page that covers every term, and plans a page otherwise', () => {
    const pages = [
      {
        site_url_id: 'p1',
        analysis_id: 'a1',
        url: 'https://www.example.com/running',
        text: 'Running shoes for everyone',
      },
      {
        site_url_id: 'p2',
        analysis_id: 'a2',
        url: 'https://www.example.com/socks',
        text: 'Trail socks',
      },
      {
        site_url_id: 'p3',
        analysis_id: 'a3',
        url: 'https://www.example.com/more-socks',
        text: 'Socks for the trail',
      },
    ];
    const { hits } = searchGapDecisions(
      inputs([row('running shoes'), row('trail socks'), row('tennis rackets')], { pages }),
    );
    const byTheme = new Map(hits.map((hit) => [hit.target_theme, hit]));
    expect(byTheme.get('running shoes')).toMatchObject({
      target_url: 'https://www.example.com/running',
      source_analysis_ids: ['a1'],
      evidence: { site_url_id: 'p1' },
    });
    expect(byTheme.get('trail socks')).toMatchObject({
      target_url: null,
      evidence: { target_resolution: { state: 'ambiguous' } },
    });
    expect(byTheme.get('tennis rackets')?.target_url).toBeNull();
  });

  it('caps one refresh and says what it left out', () => {
    const rows = Array.from({ length: g.MAX_HITS_PER_REFRESH + 3 }, (_, index) =>
      row(`widget ${String.fromCharCode(97 + (index % 26))}${index}`),
    );
    const { hits, limitations } = searchGapDecisions(
      inputs(rows, { search_console: null, rows_truncated: true }),
    );
    expect(hits).toHaveLength(g.MAX_HITS_PER_REFRESH);
    expect(limitations.join(' ')).toContain('3 more keyword gaps');
    expect(limitations.join(' ')).toContain('Search Console is not connected');
    expect(limitations.join(' ')).toContain('highest-volume gap rows');
  });
});
