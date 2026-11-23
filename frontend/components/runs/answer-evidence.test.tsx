import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';

import type { ExecutionEvidence } from '@citeladder/contracts';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { AnswerEvidence } from './answer-evidence';

const ID = '11111111-1111-4111-8111-111111111111';
const evidence: ExecutionEvidence = {
  id: ID,
  analysis_id: ID,
  audit_id: ID,
  task_id: ID,
  artifact_id: null,
  analyzer_version: '1',
  scoring_rule_version: '1',
  logical_engine: 'chatgpt',
  transport_provider: 'openai',
  transport_model: 'gpt-4',
  retrieval_enabled: true,
  prompt_index: 0,
  repetition: 1,
  prompt_class: 'unbranded',
  cohort: 'core',
  answer_text: '',
  search_surface_outcome: '',
  brand_mentioned: true,
  brand_first_offset: null,
  owned_domain_cited: false,
  owned_citation_count: 0,
  unintended_domain_cited: false,
  citation_count: 0,
  search_used: false,
  search: 'not_used',
  search_query_count: 0,
  avg_position: null,
  first_named: { kind: 'none' },
  named: [],
  answer_formats: { kind: 'not_applicable' },
  score: null,
  citations: [],
  competitors_mentioned: [],
  search_surface: null,
  perception: [],
  claims: [],
  ads: { applicability: 'not_applicable', parser_version: null, items: [] },
  created_at: '2026-01-15T00:00:00Z',
};

const project = makeProject({
  brand_name: 'Acme',
  website_url: 'https://acme.example',
  competitors: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Rival Co',
      aliases: [],
      domains: ['rival.example'],
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Other Brand',
      aliases: [],
      domains: ['other.example'],
    },
  ],
});

const citation = (url: string, domain: string, ordinal: number, owned = false) => ({
  ordinal,
  url,
  title: '',
  domain,
  classification: owned ? ('owned' as const) : ('third_party' as const),
  is_owned: owned,
  is_unintended: false,
  matched_competitor: null,
});

type Searches = { state: string; search_events: { sequence: number; query: string }[] };

function serveSearches(searches: Searches | null) {
  mswServer.use(
    http.get('/api/v1/projects/:id/visibility/evidence', () =>
      HttpResponse.json({
        truncated: false,
        items: searches
          ? [
              {
                audit_id: ID,
                task_id: ID,
                analysis_id: ID,
                artifact_id: null,
                prompt_snapshot_id: ID,
                prompt_id: null,
                prompt_index: 0,
                prompt_text: 'best plumber',
                repetition: 1,
                completed_at: null,
                logical_engine: 'chatgpt',
                transport_provider: 'openai',
                transport_model: 'gpt-4',
                retrieval_enabled: true,
                search_used: true,
                search_query_count: searches.search_events.length,
                query_text_available: true,
                event_source: 'raw_artifact',
                mentions: [],
                citations: [],
                state: searches.state,
                search_events: searches.search_events.map((event) => ({
                  ...event,
                  call_id: 'c',
                  call_sequence: 0,
                  query_sequence: event.sequence,
                })),
              },
            ]
          : [],
      }),
    ),
  );
}

function renderAnswer(subject: Partial<ExecutionEvidence>, attributes = false) {
  return renderWithProviders(
    <AnswerEvidence
      evidence={{ ...evidence, ...subject }}
      promptText="best plumber"
      attributes={attributes}
    />,
    { projectSelection: { activeProject: project } },
  );
}

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => serveSearches(null));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Answer transcript', () => {
  it('draws a brand chip where the answer names a brand with an offset, and lists the rest in the rail only', async () => {
    serveSearches({
      state: 'queries_available',
      search_events: [
        { sequence: 0, query: 'plumbers near me' },
        { sequence: 1, query: '' },
      ],
    });
    renderAnswer({
      answer_text:
        'Try **Acme** or Rival Co. See [plumb.example](https://plumb.example/guide), or ask Other Brand.',
      brand_first_offset: 4,
      competitors_mentioned: ['Rival Co', 'Other Brand'],
      named: [
        { name: 'Acme', kind: 'brand', offset: 4, position: 1 },
        { name: 'Rival Co', kind: 'competitor', offset: 12, position: 2 },
        { name: 'Other Brand', kind: 'competitor', offset: null, position: null },
      ],
      citations: [
        citation('https://plumb.example/guide', 'plumb.example', 1),
        citation('https://acme.example/', 'acme.example', 2, true),
        citation('https://plumb.example/guide', 'plumb.example', 3),
      ],
    });

    const conversation = screen.getByRole('list', { name: 'Conversation' });
    expect(within(conversation).getByText('best plumber')).toBeVisible();
    const chips = [...conversation.querySelectorAll('[data-brand-chip]')];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Position 1AAcmeYou',
      'Position 2RRival Co',
    ]);
    expect(chips[0]?.closest('strong')).not.toBeNull();
    expect(within(chips[0] as HTMLElement).getByText('You')).toBeVisible();
    expect(within(conversation).getByText(/or ask Other Brand\./u)).toBeVisible();

    const brands = screen.getByRole('list', { name: 'Brands, by first mention' });
    expect(
      within(brands)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Position 1AAcmeYou', 'Position 2RRival Co', '—Position not recordedOOther Brand']);

    const link = within(conversation).getByRole('link', { name: /plumb\.example/u });
    expect(link).toHaveAttribute('href', 'https://plumb.example/guide');
    expect(link).toHaveAttribute('data-source-chip', 'plumb.example');
    const sources = screen.getByRole('list', { name: 'Sources' });
    expect(within(sources).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sources).getByText('(2)')).toBeVisible();
    expect(within(sources).getAllByText('You')).toHaveLength(1);

    const searches = await screen.findByRole('list', { name: 'Searches the engine ran' });
    expect(
      within(searches)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['plumbers near me']);
  });

  it('lists each address the answer text links to once, with its count and a You on your own site', () => {
    const { unmount } = renderAnswer({
      answer_text: [
        'See [Rival](https://rival.example/a), [our page](https://www.acme.example/plans)',
        'and [Rival [again](https://rival.example/a), not ![a picture](https://img.example/p.png)',
        'or [a script](javascript:alert(1)).',
      ].join(' '),
      answer_formats: { kind: 'observed', formats: [], in_text_links: 2 },
    });
    const links = screen.getByRole('list', { name: 'Links in the answer' });
    expect(
      within(links)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Rrival.example(2)https://rival.example/a (opens in a new tab)',
      'Aacme.exampleYou(1)https://www.acme.example/plans (opens in a new tab)',
    ]);
    unmount();

    const { unmount: second } = renderAnswer({
      answer_text: 'No links here.',
      answer_formats: { kind: 'observed', formats: [], in_text_links: 0 },
    });
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Links' })).toBeNull();
    second();
    renderAnswer({
      answer_text: 'See [Rival](https://rival.example/a).',
      answer_formats: { kind: 'unavailable' },
    });
    const section = screen.getByRole('heading', { name: 'Links' }).closest('section');
    expect(section?.textContent).toBe('Links—Unavailable');
  });

  it('says when no searches ran, apart from withheld wording and wording never read', async () => {
    serveSearches({ state: 'no_search', search_events: [] });
    const { unmount } = renderAnswer({});
    expect(
      await screen.findByText('The engine ran no searches for this answer.'),
    ).toBeInTheDocument();
    unmount();
    serveSearches({
      state: 'no_exposed_queries',
      search_events: [
        { sequence: 0, query: '' },
        { sequence: 1, query: '' },
      ],
    });
    const { unmount: second } = renderAnswer({ search_used: true, search_query_count: 3 });
    expect(
      await screen.findByText('2 searches ran; the engine did not expose their wording.'),
    ).toBeInTheDocument();
    second();
    serveSearches(null);
    renderAnswer({ search_used: true, search_query_count: 3 });
    expect(
      await screen.findByText('3 searches ran; their wording is unavailable.'),
    ).toBeInTheDocument();
  });
});

describe('Search evidence', () => {
  it('keeps a search the engine never reported apart from one it did not run', () => {
    const searchCheck = () =>
      screen.getByText('Grounded with search').nextElementSibling?.textContent;
    const { unmount } = renderAnswer({ search: 'not_used' });
    expect(searchCheck()).toBe('The engine ran no web search');
    unmount();
    renderAnswer({ search: 'not_reported' });
    expect(searchCheck()).toBe(
      'Not reported: this engine does not say whether it searched the web',
    );
  });
});

describe('Brand match evidence', () => {
  it.each([
    [true, null, 'Brand detected; match position unavailable'],
    [true, 0, 'First match at character 0'],
    [false, null, 'No tracked brand alias appeared in the answer'],
  ] as const)('keeps mention %s and offset %s distinct', (mentioned, offset, label) => {
    renderAnswer({ brand_mentioned: mentioned, brand_first_offset: offset });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('Answer perception evidence', () => {
  it('labels each named business, marks its verified quotes and lists attributes only when asked', () => {
    const subject: Partial<ExecutionEvidence> = {
      answer_text: 'Acme support is slow. Rival is fine.',
      perception: [
        {
          entity: 'Acme',
          is_brand: true,
          state: 'classified',
          reason: null,
          label: 'negative',
          confidence: 0.9,
          extractor_version: 'x1',
          template_version: 't1',
          aspects: [
            {
              theme: 'Support',
              attribute: { kind: 'labelled', name: 'Slow support' },
              polarity: 'negative',
              quote: 'support is slow',
              start: 5,
              end: 20,
            },
          ],
        },
        {
          entity: 'Rival',
          is_brand: false,
          state: 'pending',
          reason: null,
          label: null,
          confidence: null,
          extractor_version: 'x1',
          template_version: 't1',
          aspects: [],
        },
      ],
    };
    const { unmount } = renderAnswer(subject);
    expect(screen.queryByRole('list', { name: 'Attributes' })).toBeNull();
    expect(screen.getByText('Negative')).toBeVisible();
    expect(screen.getByText('Classifying…')).toBeVisible();
    expect(screen.getByText('Support (negative): “support is slow”')).toBeVisible();
    expect(document.querySelector('mark')?.textContent).toBe('support is slow');
    unmount();
    renderAnswer(subject, true);
    const listed = screen.getByRole('list', { name: 'Attributes' });
    expect(listed.textContent).toBe('Slow supportNegative');
  });
});

describe('Ads evidence', () => {
  it('lists a ChatGPT Search answer’s ads apart from its citations, by canonical landing page', () => {
    renderAnswer({
      logical_engine: 'chatgpt_search',
      ads: {
        applicability: 'applicable',
        parser_version: 'chatgpt-ads-1',
        items: [
          {
            rank_absolute: 2,
            advertiser_name: 'Rival',
            advertiser_domain: 'rival.example',
            ownership: 'competitor',
            title: 'Rival Runner 3',
            snippet: 'Free returns on every pair.',
            landing_url: 'https://shop.rival.example/runner-3',
          },
        ],
      },
    });
    expect(screen.getByText('Ads in this answer')).toBeInTheDocument();
    expect(screen.getByText('Rival Runner 3')).toBeInTheDocument();
    expect(
      screen.getByText('Sponsored by Rival · shop.rival.example/runner-3'),
    ).toBeInTheDocument();
    expect(screen.getByText('Competitor')).toBeInTheDocument();
  });

  it('says when an answer showed no ads, and when it was not read for ads', () => {
    const { unmount } = renderAnswer({
      ads: { applicability: 'applicable', parser_version: 'chatgpt-ads-1', items: [] },
    });
    expect(screen.getByText('No ads were shown with this answer.')).toBeInTheDocument();
    unmount();
    renderAnswer({ ads: { applicability: 'unavailable', parser_version: null, items: [] } });
    expect(screen.getByText('Ads were not read for this answer.')).toBeInTheDocument();
  });
});
