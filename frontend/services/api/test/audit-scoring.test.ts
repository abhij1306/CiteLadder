import { describe, expect, it } from 'vitest';
import { scoreExecution, scoringConfig } from '../src/analysis/scoring.ts';
import { assessEntities } from '../src/analysis/entity-assessment.ts';
import { citationIdentity } from '../src/source-pages/identity.ts';
import { normalizeAlias, firstAliasOffset } from '../src/analysis/aliases.ts';
const config = scoringConfig({
  brand_name: 'Acme & Co',
  brand_aliases: ['Summitwear'],
  owned_domains: ['summitwear.example'],
  unintended_domains: ['old.example'],
  products_services: ['running shoes'],
  competitors: [{ name: 'Rival', domains: ['rival.example'] }],
});
describe('frozen deterministic execution scoring', () => {
  it('distinguishes prompt contamination, query availability, mention order and qualified citations', () => {
    const score = scoreExecution({
      config,
      answerText: '😀 Rival first. Then summitwear.',
      promptText: 'Compare Rival shoes',
      searchUsed: true,
      queryTextAvailable: true,
      searchEvents: [{ query: 'best summitwear running shoes review' }],
      citations: [
        { url: 'https://summitwear.example/shoes', title: 'Running shoes' },
        { url: 'https://rival.example/shoes' },
        { url: 'https://old.example/history' },
      ],
    });
    expect(score).toMatchObject({
      brand_mentioned: true,
      brand_injected_in_search: true,
      prompt_class: 'mixed',
      competitors_injected_in_search: [],
      brand_position: 2,
      owned_citation_count: 1,
      qualified_owned_citation_count: 1,
      competitor_domains_cited: ['Rival'],
      unintended_domain_cited: true,
      fanout_features: ['comparison', 'review'],
    });
    const unavailable = scoreExecution({
      config,
      answerText: '',
      promptText: 'Acme & Co shoes',
      searchUsed: true,
      queryTextAvailable: false,
      searchEvents: [],
      citations: [],
    });
    expect(unavailable).toMatchObject({
      brand_mentioned: false,
      brand_first_offset: null,
      brand_position: null,
      brand_injected_in_search: null,
      search_query_text_available: false,
      prompt_class: 'branded',
    });
  });
  it('counts a context-required brand only with nearby context, as frozen in the audit block', () => {
    const target = scoringConfig({
      brand_name: 'Target',
      entity_matching: {
        version: 'entity-matching-1',
        entities: {
          target: {
            mode: 'context_required',
            context_terms: ['store', 'Australia'],
            exclusion_phrases: ['target audience'],
          },
        },
      },
    });
    const score = (answerText: string) =>
      scoreExecution({
        config: target,
        answerText,
        promptText: '',
        searchUsed: false,
        queryTextAvailable: true,
        searchEvents: [],
        citations: [],
      });
    expect(score('Know your target audience before you visit a store.')).toMatchObject({
      brand_mentioned: false,
    });
    expect(score('Hit the target price.')).toMatchObject({ brand_mentioned: false });
    expect(score('Is there a Target store near me?')).toMatchObject({
      brand_mentioned: true,
      brand_first_offset: 11,
    });
    expect(score('target Australia')).toMatchObject({ brand_mentioned: true });
    // An audit frozen before policies counts every occurrence.
    expect(
      scoreExecution({
        config: scoringConfig({ brand_name: 'Target' }),
        answerText: 'the target audience',
        promptText: '',
        searchUsed: false,
        queryTextAvailable: true,
        searchEvents: [],
        citations: [],
      }),
    ).toMatchObject({ brand_mentioned: true });
    const [brand] = assessEntities(
      'Define the target audience. Then a Target store helps.',
      target,
    );
    expect(brand).toMatchObject({ state: 'mentioned' });
    expect(brand!.evidence_spans[0]!.text).toContain('Target store');
    expect(assessEntities('Define the target audience first.', target)[0]!.state).toBe('absent');
  });
  it('finds names inside sentences of scripts written without spaces', () => {
    const score = (brand_name: string, answerText: string) =>
      scoreExecution({
        config: scoringConfig({ brand_name }),
        answerText,
        promptText: '',
        searchUsed: false,
        queryTextAvailable: true,
        searchEvents: [],
        citations: [],
      }).brand_mentioned;
    expect(score('小米', 'おすすめのスマートフォンは小米です。')).toBe(true);
    expect(score('ชาตรามือ', 'ร้านชาที่ดีที่สุดคือชาตรามือ')).toBe(true);
    expect(score('小米', 'おすすめのスマートフォンはありません。')).toBe(false);
    expect(
      assessEntities('おすすめは小米です。', scoringConfig({ brand_name: '小米' }))[0]!.state,
    ).toBe('mentioned');
  });
  it('rejects a near-miss alias over a long dense-script answer without stalling', () => {
    const nearMiss = scoringConfig({
      brand_name: 'Acme',
      brand_aliases: ['的 的 的 的 的 的 的 的 x'],
    });
    const started = performance.now();
    const [brand] = assessEntities('的'.repeat(5000), nearMiss);
    expect(brand!.state).toBe('absent');
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('rejects an "and" near-miss over a long run of ampersands without stalling, and still reads &', () => {
    const nearMiss = scoringConfig({ brand_name: 'Acme', brand_aliases: ['and and and and x'] });
    const started = performance.now();
    const [brand] = assessEntities(`a ${'&'.repeat(5000)}`, nearMiss);
    expect(brand!.state).toBe('absent');
    expect(performance.now() - started).toBeLessThan(1000);
    const pair = scoringConfig({ brand_name: 'Tom and Jerry' });
    expect(assessEntities('Watch Tom & Jerry tonight.', pair)[0]!.state).toBe('mentioned');
  });
  it('matches a spaced name written hyphenated, spaced or joined', () => {
    const hardware = scoringConfig({ brand_name: 'Ace Hardware' });
    const spans = (answer: string) =>
      assessEntities(answer, hardware)[0]!.evidence_spans.map((span) => span.text);
    expect(spans('Try ace-hardware today.')).toEqual(['Try ace-hardware today.']);
    expect(spans('Try Ace Hardware today.')).toEqual(['Try Ace Hardware today.']);
    expect(spans('Try AceHardware today.')).toEqual(['Try AceHardware today.']);
    expect(spans('Try Acer hardware today.')).toEqual([]);
  });
  it('preserves code-point ordering after Unicode folding', () => {
    expect(firstAliasOffset('Straße', normalizeAlias('😀 Rival then STRASSE'))).toBe(11);
    expect(firstAliasOffset('DuranDuran', normalizeAlias('Duran DuranDuran'))).toBe(6);
  });
  it('retains first-mention recommendation limits and raw Unicode evidence spans', () => {
    for (const tense of ['', 'is ', 'are ', 'was ', 'were ']) {
      expect(assessEntities(`Rival ... ${tense}not recommended.`, config)[1]!.state).toBe(
        'recommended_against',
      );
      expect(assessEntities(`Rival ... ${tense}recommended.`, config)[1]!.state).toBe(
        'recommended',
      );
    }
    const rows = assessEntities(
      '😀 Consider Acme&Co. Later we recommend Acme and Co. Rival is not recommended.',
      config,
    );
    expect(rows.map((row) => [row.entity_name, row.state])).toEqual([
      ['Acme & Co', 'hedged'],
      ['Rival', 'recommended_against'],
    ]);
    const points = Array.from(
      '😀 Consider Acme&Co. Later we recommend Acme and Co. Rival is not recommended.',
    );
    for (const row of rows)
      for (const span of row.evidence_spans)
        expect(points.slice(span.start, span.end).join('')).toBe(span.text);
    expect(assessEntities('', config).map((row) => row.state)).toEqual([
      'unavailable',
      'unavailable',
    ]);
  });
  it('keeps grounding tokens unresolved and canonicalizes real publisher identity offline', () => {
    const first = citationIdentity('https://publisher.example/shoes?utm_source=engine&size=8#part');
    expect(first.url_hash).toBe(
      citationIdentity('https://publisher.example/shoes?size=8').url_hash,
    );
    expect(
      citationIdentity('https://vertexaisearch.cloud.google.com/grounding-api-redirect/token'),
    ).toMatchObject({ url_identity_method: 'unresolved', url_hash: null });
    expect(citationIdentity('https://user:pass@publisher.example/private')).toMatchObject({
      url_hash: null,
    });
    expect(citationIdentity('https://publisher.example/shoes', true)).toMatchObject({
      resolved_url: 'https://publisher.example/shoes',
      url_identity_method: 'verbatim',
    });
  });
});
