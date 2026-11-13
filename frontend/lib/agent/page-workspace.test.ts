import { describe, expect, it } from 'vite-plus/test';

import { fieldSuggestion, spanSuggestion } from '@/test/page-suggestions-fixture';

import {
  groupByPassage,
  pageOutline,
  suggestionHighlights,
  withQuotedReference,
} from './page-workspace';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004';

describe('pageOutline', () => {
  it('lists the ATX headings with their line offsets, skipping fenced code', () => {
    const body =
      '# Pricing **plans**\n\nIntro.\n\n```\n# not a heading\n```\n\n## [Teams](/teams) ##\n';
    expect(pageOutline(body)).toEqual([
      { level: 1, text: 'Pricing plans', from: 0 },
      { level: 2, text: 'Teams', from: body.indexOf('## [Teams]') },
    ]);
  });

  it('drops only a closing # sequence that follows a blank', () => {
    const body = '## C# tips #  \n### Plans ## and #\n#### ##\n# \t \n##### Done\t##\t\n';
    expect(pageOutline(body).map(({ level, text }) => [level, text])).toEqual([
      [2, 'C# tips'],
      [3, 'Plans ## and'],
      [4, '##'],
      [5, 'Done'],
    ]);
  });

  it('reads links and images in a heading as their text', () => {
    const body = '# ![Logo](/logo.png) and [Teams](/teams) [not closed\n## [a [b](/b)\n';
    expect(pageOutline(body).map(({ text }) => text)).toEqual([
      'Logo and Teams [not closed',
      '[a b',
    ]);
  });
});

describe('groupByPassage', () => {
  it('groups body suggestions by passage, then fields and the whole page', () => {
    const body = '## Pricing\n\nOur plans start at ten dollars. Teams pay more.\n\nContact sales.';
    const groups = groupByPassage(
      [
        spanSuggestion(A, body, 'start at ten dollars'),
        spanSuggestion(B, body, 'Teams pay more'),
        spanSuggestion(C, body, 'Contact sales'),
        fieldSuggestion(D, 'meta_description'),
        {
          ...fieldSuggestion('aaaaaaaa-0000-4000-8000-000000000005', 'title'),
          anchor: { kind: 'page' },
        },
      ],
      body,
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Our plans start at ten dollars. Teams pay more.', [A, B]],
      ['Contact sales.', [C]],
      ['Meta description', [D]],
      ['The whole page', ['aaaaaaaa-0000-4000-8000-000000000005']],
    ]);
  });
});

describe('suggestionHighlights', () => {
  it('highlights open body suggestions only, amber when one needs a fact', () => {
    const body = 'Ships in two days. Costs less.';
    const highlights = suggestionHighlights(
      [
        spanSuggestion(A, body, 'two days'),
        spanSuggestion(B, body, 'Costs less', { readiness: 'needs_input' }),
        spanSuggestion(C, body, 'Ships', { status: 'applied' }),
        fieldSuggestion(D, 'title'),
      ],
      (suggestion) => `Label ${suggestion.id.slice(-1)}`,
    );
    expect(highlights).toEqual([
      { id: A, from: 9, to: 17, tone: 'ready', label: 'Label 1' },
      { id: B, from: 19, to: 29, tone: 'needs_input', label: 'Label 2' },
    ]);
  });
});

describe('withQuotedReference', () => {
  it('quotes the passage over a starting request in an empty composer', () => {
    expect(
      withQuotedReference('  ', { quote: 'First line.\n\nSecond line.', request: 'Improve it.' }),
    ).toBe('> First line.\n>\n> Second line.\n\nImprove it.');
  });

  it('appends the quote after what the person already wrote', () => {
    expect(
      withQuotedReference('Make it warmer.\n', { quote: 'Our plans', request: 'Ignored.' }),
    ).toBe('Make it warmer.\n\n> Our plans');
  });
});
