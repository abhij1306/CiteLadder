import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import type { ExecutionEvidence } from '@/lib/api/types';
import { EvidenceCard } from './evidence-card';

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
  brand_mentioned: true,
  brand_first_offset: null,
  owned_domain_cited: false,
  owned_citation_count: 0,
  unintended_domain_cited: false,
  citation_count: 0,
  search_used: false,
  search_query_count: 0,
  avg_position: null,
  score: null,
  citations: [],
  competitors_mentioned: [],
  search_surface: null,
  perception: [],
  claims: [],
  ads: { applicability: 'not_applicable', parser_version: null, items: [] },
  created_at: '2026-01-15T00:00:00Z',
};

describe('Brand match evidence', () => {
  it.each([
    [true, null, 'Brand detected; match position unavailable'],
    [true, 0, 'First match at character 0'],
    [false, null, 'No tracked brand alias appeared in the answer'],
  ] as const)('keeps mention %s and offset %s distinct', (mentioned, offset, label) => {
    render(
      <EvidenceCard
        evidence={{ ...evidence, brand_mentioned: mentioned, brand_first_offset: offset }}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('Answer perception evidence', () => {
  it('labels each named business and marks its verified quotes in the answer', () => {
    render(
      <EvidenceCard
        answerText="Acme support is slow. Rival is fine."
        evidence={{
          ...evidence,
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
                  theme: 'support',
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
        }}
      />,
    );
    expect(screen.getByText('Negative')).toBeVisible();
    expect(screen.getByText('Classifying…')).toBeVisible();
    expect(screen.getByText('Support (negative): “support is slow”')).toBeVisible();
    expect(document.querySelector('mark')?.textContent).toBe('support is slow');
  });
});

describe('Ads evidence', () => {
  it('lists a ChatGPT Search answer’s ads apart from its citations, by canonical landing page', () => {
    render(
      <EvidenceCard
        evidence={{
          ...evidence,
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
        }}
      />,
    );
    expect(screen.getByText('Ads in this answer')).toBeInTheDocument();
    expect(screen.getByText('Rival Runner 3')).toBeInTheDocument();
    expect(
      screen.getByText('Sponsored by Rival · shop.rival.example/runner-3'),
    ).toBeInTheDocument();
    expect(screen.getByText('Competitor')).toBeInTheDocument();
  });

  it('says when an answer showed no ads, and when it was not read for ads', () => {
    const { rerender } = render(
      <EvidenceCard
        evidence={{
          ...evidence,
          ads: { applicability: 'applicable', parser_version: 'chatgpt-ads-1', items: [] },
        }}
      />,
    );
    expect(screen.getByText('No ads were shown with this answer.')).toBeInTheDocument();
    rerender(
      <EvidenceCard
        evidence={{
          ...evidence,
          ads: { applicability: 'unavailable', parser_version: null, items: [] },
        }}
      />,
    );
    expect(screen.getByText('Ads were not read for this answer.')).toBeInTheDocument();
  });
});
