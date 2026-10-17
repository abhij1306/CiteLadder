import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';
import type { SearchSurfaceEvidence, SurfaceEntity } from '@/lib/api/types';

import { SurfaceEvidence } from './surface-evidence';

/**
 * The two things this panel exists to keep straight.
 *
 * First, that mentioned / linked / cited stay three columns. They are three
 * independent observations that come apart in both directions, and a reader
 * who sees them collapse into one "appeared" cell has lost the finding.
 *
 * Second, that "Google showed no overview" and "we never managed to look" are
 * never the same sentence. The first is a measurement; the second is a gap in
 * ours, and presenting it as the brand's absence is the worst thing this
 * surface could do.
 */

function entity(overrides: Partial<SurfaceEntity> = {}): SurfaceEntity {
  return {
    name: 'Acme Corp',
    kind: 'brand',
    mentioned: false,
    linked: false,
    cited: false,
    first_offset: null,
    mention_order: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<SearchSurfaceEvidence> = {}): SearchSurfaceEvidence {
  return {
    outcome: 'ai_overview_present',
    aio_present: true,
    aio_serp_position: 1,
    provider_status_code: 20000,
    error_code: '',
    element_count: 3,
    reference_count: 2,
    location_code: 2036,
    language_code: 'en',
    device: 'desktop',
    observed_at: '2026-01-05T00:00:00Z',
    retrieved_at: '2026-01-05T00:05:00Z',
    links: [],
    entities: [entity()],
    ...overrides,
  };
}

/**
 * The three signal cells of one row, each with the label only a screen reader
 * hears. Asserting the prefix too is deliberate: a bare "Yes" three columns
 * along is meaningless without sight of the header.
 */
function signalsFor(name: string): string[] {
  const row = screen.getByRole('row', { name: new RegExp(name) });
  return within(row)
    .getAllByRole('cell')
    .slice(0, 3)
    .map((cell) => cell.textContent?.trim() ?? '');
}

function signals(named: string, linked: string, cited: string): string[] {
  return [
    `Named in the answer: ${named}`,
    `Linked from the answer: ${linked}`,
    `Cited in the references: ${cited}`,
  ];
}

describe('AI Overview evidence', () => {
  it('shows linked-but-not-cited as its own combination', () => {
    render(
      <SurfaceEvidence
        evidence={evidence({
          entities: [entity({ linked: true })],
          links: [
            {
              url: 'https://acme.example/guide',
              domain: 'acme.example',
              title: '',
              element_index: 0,
            },
          ],
        })}
      />,
    );

    // Named No, Linked Yes, Cited No. Deriving any one of these from another
    // would make all three read the same.
    expect(signalsFor('Acme Corp')).toEqual(signals('No', 'Yes', 'No'));
  });

  it('shows cited-but-not-linked as its own combination', () => {
    render(<SurfaceEvidence evidence={evidence({ entities: [entity({ cited: true })] })} />);

    expect(signalsFor('Acme Corp')).toEqual(signals('No', 'No', 'Yes'));
  });

  it('names an unranked brand rather than giving it a position', () => {
    render(<SurfaceEvidence evidence={evidence({ entities: [entity({ cited: true })] })} />);

    // Never named is not last place, so it must not arrive as a number.
    expect(screen.getByText('Not named')).toBeVisible();
  });

  it('separates a measured absence from a retrieval we never completed', () => {
    const { unmount } = render(
      <SurfaceEvidence
        evidence={evidence({
          outcome: 'no_ai_overview',
          aio_present: false,
          aio_serp_position: null,
        })}
      />,
    );
    expect(screen.getByText(/Google showed no AI Overview/)).toBeVisible();
    unmount();

    render(
      <SurfaceEvidence
        evidence={evidence({
          outcome: 'execution_failure',
          aio_present: null,
          aio_serp_position: null,
        })}
      />,
    );
    expect(screen.getByText(/never successfully retrieved/)).toBeVisible();
    expect(screen.queryByText(/Google showed no AI Overview/)).toBeNull();
  });

  it('keeps the presence table out of a run that observed nothing', () => {
    render(
      <SurfaceEvidence
        evidence={evidence({
          outcome: 'no_ai_overview',
          aio_present: false,
          entities: [entity()],
        })}
      />,
    );

    // With no overview there is nothing to have appeared in, so a table of
    // "No, No, No" would read as the brand losing rather than as no contest.
    expect(screen.queryByRole('table')).toBeNull();
  });
});
