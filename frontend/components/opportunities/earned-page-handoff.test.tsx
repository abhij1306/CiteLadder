import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import type { OpportunityDetail } from '@/lib/api/types';
import { renderWithProviders as render } from '@/test/render';

import { EarnedPageHandoff } from './earned-page-handoff';

/**
 * The brief is the whole case for doing the work. It was being fetched,
 * validated and dropped in favour of one sentence and a button.
 *
 * Two things here are the feature, not decoration: a positive claim about a
 * page we do not own always shows the line it rests on, and the competitors
 * found ON the page never merge with the ones merely named in an answer.
 */
function detailWith(handoff: Partial<OpportunityDetail['content_handoff']>): OpportunityDetail {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    content_handoff: {
      opportunity_id: '22222222-2222-4222-8222-222222222222',
      pathway: 'earned',
      source_class: 'editorial_third_party',
      canonical_domain: 'publisher.example',
      suggested_role: 'PR',
      suggested_skill_id: 'listicle',
      target_url: 'https://publisher.example/best-crm',
      target_theme: 'crm',
      representative_citations: [],
      affected_themes: [],
      observed_competitors: ['Globex'],
      coverage: {},
      limitations: [],
      truncated: false,
      source_analysis_ids: [],
      snapshot_versions: {},
      ...handoff,
    },
  } as unknown as OpportunityDetail;
}

const ENTITIES = [
  {
    entity_kind: 'brand',
    entity_name: 'Acme Corp',
    presence: 'not_detected',
    match_method: 'exact_alias',
    match_count: 0,
    passages: [],
  },
  {
    entity_kind: 'competitor',
    entity_name: 'Globex',
    presence: 'present',
    match_method: 'exact_alias',
    match_count: 2,
    passages: ['Globex leads the field for small teams.'],
  },
];

describe('the grounded brief behind an earned action', () => {
  it('shows the rival on the page beside the line that proves it', () => {
    render(
      <EarnedPageHandoff
        detail={detailWith({
          rule_id: 'earned_page_acquire_listing',
          page_format: 'listicle',
          page_entities: ENTITIES,
          extracted_chars: 4200,
        })}
      />,
    );

    expect(screen.getByText('Globex')).toBeVisible();
    expect(screen.getByText(/Globex leads the field for small teams\./)).toBeVisible();
    expect(screen.getByText('Listicle')).toBeVisible();
    expect(screen.getByText(/Get listed on this page/)).toBeVisible();
  });

  it('reports a non-detection with its coverage and method, never a passage', () => {
    render(
      <EarnedPageHandoff
        detail={detailWith({
          rule_id: 'earned_page_acquire_listing',
          page_entities: ENTITIES,
          extracted_chars: 4200,
        })}
      />,
    );

    expect(screen.getByText(/Acme Corp — not found on the page/)).toBeVisible();
    expect(
      screen.getByText(/Searched 4,200 characters of readable text for the exact name\./),
    ).toBeVisible();
  });

  it('keeps names found on the page apart from names merely in an answer', () => {
    render(
      <EarnedPageHandoff
        detail={detailWith({
          rule_id: 'earned_page_acquire_listing',
          page_entities: ENTITIES,
          answer_competitors: ['Initech'],
        })}
      />,
    );

    const onPage = screen.getByText('Found on this page').parentElement!;
    const inAnswers = screen.getByText('Named in the answers, not on the page').parentElement!;
    expect(within(onPage).getByText('Globex')).toBeVisible();
    expect(within(onPage).queryByText('Initech')).toBeNull();
    expect(within(inAnswers).getByText('Initech')).toBeVisible();
  });

  it('says what to ask the publisher for and which prompts will measure it', () => {
    render(
      <EarnedPageHandoff
        detail={detailWith({
          rule_id: 'earned_page_acquire_listing',
          page_entities: ENTITIES,
          ask: 'Be included on this page alongside Globex.',
          affected_prompts: [
            {
              prompt_id: '33333333-3333-4333-8333-333333333333',
              text: 'best crm for small teams',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('Be included on this page alongside Globex.')).toBeVisible();
    const prompts = screen.getByText('Prompts that cite this page').parentElement!;
    expect(within(prompts).getByRole('listitem')).toHaveTextContent('best crm for small teams');
  });
});
