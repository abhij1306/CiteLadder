import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';
import type { SearchSurfaceEvidence, SurfaceEntity } from '@citeladder/contracts';

import { SurfaceEvidence } from './surface-evidence';

function entity(overrides: Partial<SurfaceEntity> = {}): SurfaceEntity {
  return {
    name: 'Acme Corp',
    kind: 'brand',
    logo_url: null,
    website_url: null,
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
        engine="google_ai_overview"
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

    expect(signalsFor('Acme Corp')).toEqual(signals('No', 'Yes', 'No'));
  });

  it('shows cited-but-not-linked as its own combination', () => {
    render(
      <SurfaceEvidence
        engine="google_ai_overview"
        evidence={evidence({ entities: [entity({ cited: true })] })}
      />,
    );

    expect(signalsFor('Acme Corp')).toEqual(signals('No', 'No', 'Yes'));
  });

  it('names an unranked brand rather than giving it a position', () => {
    render(
      <SurfaceEvidence
        engine="google_ai_overview"
        evidence={evidence({ entities: [entity({ cited: true })] })}
      />,
    );

    expect(screen.getByText('Not named')).toBeVisible();
  });

  it('separates a measured absence from a retrieval we never completed', () => {
    const { unmount } = render(
      <SurfaceEvidence
        engine="google_ai_overview"
        evidence={evidence({
          outcome: 'no_ai_overview',
          aio_present: false,
          aio_serp_position: null,
        })}
      />,
    );
    expect(screen.getByText('Not shown')).toBeVisible();
    unmount();

    render(
      <SurfaceEvidence
        engine="google_ai_overview"
        evidence={evidence({
          outcome: 'execution_failure',
          aio_present: null,
          aio_serp_position: null,
        })}
      />,
    );
    expect(screen.getByText('Not observed')).toBeVisible();
    expect(screen.queryByText('Not shown')).toBeNull();
  });

  it('keeps the presence table out of a run that observed nothing', () => {
    render(
      <SurfaceEvidence
        engine="google_ai_overview"
        evidence={evidence({
          outcome: 'no_ai_overview',
          aio_present: false,
          entities: [entity()],
        })}
      />,
    );

    expect(screen.queryByRole('table')).toBeNull();
  });
});
