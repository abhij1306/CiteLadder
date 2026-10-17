import { describe, expect, it } from 'vite-plus/test';

import type { VisibilityExecutionEvidence } from '@/lib/api/types';
import {
  normalizeSearch,
  SEARCH_MAX_LENGTH,
  searchRows,
  searchRowsByPrompt,
  searchRowsByTopic,
} from '@/lib/visibility/fanout-grouping';

function execution(
  snapshot: string,
  engine: string,
  queries: string[],
  state: VisibilityExecutionEvidence['state'] = 'queries_available',
  promptId: string | null = null,
): VisibilityExecutionEvidence {
  return {
    prompt_snapshot_id: snapshot,
    prompt_id: promptId,
    prompt_text: `Prompt ${snapshot}`,
    logical_engine: engine,
    state,
    search_events: queries.map((query) => ({ query })),
  } as VisibilityExecutionEvidence;
}

describe('normalizeSearch', () => {
  it('caps a search past the endpoint bound so both sides filter alike', () => {
    // 513 characters: one past what the fanout endpoint accepts. The browser
    // used to filter the table by the whole string while the server was asked
    // about the first 512, so the table and the "matches elsewhere" count
    // described different searches.
    const pasted = 'a'.repeat(SEARCH_MAX_LENGTH) + 'b';
    expect(pasted).toHaveLength(513);

    const needle = normalizeSearch(pasted);

    expect(needle).toHaveLength(SEARCH_MAX_LENGTH);
    expect(needle.endsWith('b')).toBe(false);
  });

  it('trims first, so surrounding space never eats a matchable character', () => {
    expect(normalizeSearch('  best crm  ')).toBe('best crm');
    expect(normalizeSearch(`  ${'a'.repeat(SEARCH_MAX_LENGTH + 8)}  `)).toHaveLength(
      SEARCH_MAX_LENGTH,
    );
  });

  it('reads an absent or blank search as no filter at all', () => {
    expect(normalizeSearch(null)).toBe('');
    expect(normalizeSearch('   ')).toBe('');
  });
});

describe('search row grouping', () => {
  it('counts each observed query while keeping engines unique and in encounter order', () => {
    const items = [
      execution('first', 'gemini', ['zebra', 'apple', 'zebra']),
      execution('second', 'chatgpt', ['apple', 'zebra']),
      execution('third', 'gemini', ['apple']),
      execution('fourth', 'claude', [], 'count_only'),
      execution('fifth', 'claude', [], 'no_search'),
      execution('sixth', 'claude', [], 'unavailable'),
      execution('seventh', 'claude', [], 'no_exposed_queries'),
    ];

    expect(searchRows(items)).toEqual([
      {
        key: 'all',
        label: null,
        rows: [
          { query: 'apple', engines: ['gemini', 'chatgpt'], occurrences: 3 },
          { query: 'zebra', engines: ['gemini', 'chatgpt'], occurrences: 3 },
        ],
        undisclosed: 1,
        silent: 1,
        unavailable: 1,
        noExposedQueries: 1,
      },
    ]);
  });

  it('keeps frozen prompts separate and groups missing topic mappings as Unclassified', () => {
    const items = [
      execution('deleted', 'gemini', ['same'], 'queries_available'),
      execution('live', 'chatgpt', ['same'], 'queries_available', 'source'),
      execution('live', 'gemini', ['other'], 'queries_available', 'source'),
    ];

    expect(searchRowsByPrompt(items).map(({ key, rows }) => [key, rows[0]?.occurrences])).toEqual([
      ['deleted', 1],
      ['live', 1],
    ]);
    expect(
      searchRowsByTopic(items, new Map([['source', 'Known']])).map(({ label, rows }) => [
        label,
        rows.map(({ query }) => query),
      ]),
    ).toEqual([
      ['Known', ['other', 'same']],
      ['Unclassified', ['same']],
    ]);
  });
});
