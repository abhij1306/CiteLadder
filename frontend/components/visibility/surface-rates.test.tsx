import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';
import type { AioRate, SurfaceRates } from '@citeladder/contracts';

import { SurfaceRatesPanel } from './surface-rates';

function rate(overrides: Partial<AioRate> = {}): AioRate {
  return {
    numerator: 0,
    denominator: 0,
    denominator_kind: 'successful_observations',
    value: null,
    ...overrides,
  };
}

function rates(overrides: Partial<SurfaceRates> = {}): SurfaceRates {
  return {
    logical_engine: 'google_ai_overview',
    successful: 100,
    with_overview: 40,
    excluded: 0,
    trigger_rate: rate({ numerator: 40, denominator: 100, value: 0.4 }),
    brand_mention_rate_when_present: rate({
      numerator: 10,
      denominator: 40,
      denominator_kind: 'observations_with_ai_overview',
      value: 0.25,
    }),
    overall_brand_visibility: rate({ numerator: 10, denominator: 100, value: 0.1 }),
    owned_citation_rate_when_present: rate({
      denominator_kind: 'observations_with_ai_overview',
    }),
    competitor_mention_rates: [],
    ...overrides,
  };
}

function panel(data: SurfaceRates) {
  return render(
    <SurfaceRatesPanel
      query={
        { data, isError: false, isFetching: false } as Parameters<
          typeof SurfaceRatesPanel
        >[0]['query']
      }
    />,
  );
}

describe('AI Overview rates', () => {
  it('publishes the three confusable rates as three different numbers', () => {
    panel(rates());

    expect(screen.getByText('40.0%')).toBeVisible();
    expect(screen.getByText('25.0%')).toBeVisible();
    expect(screen.getByText('10.0%')).toBeVisible();
  });

  it('states what each number divided by', () => {
    panel(rates());

    for (const basis of [
      /40 of 100 searches we successfully observed/,
      /10 of 40 searches that showed an overview/,
    ])
      expect(screen.getByRole('button', { description: basis })).toHaveAccessibleName(/^Basis of /);
  });

  it('renders an empty denominator as unavailable, never as 0%', () => {
    panel(rates());

    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('gives every competitor rate its own numerator', () => {
    panel(
      rates({
        competitor_mention_rates: [
          {
            name: 'Globex',
            logo_url: null,
            website_url: null,
            rate: rate({
              numerator: 1,
              denominator: 40,
              denominator_kind: 'observations_with_ai_overview',
              value: 0.025,
            }),
          },
          {
            name: 'Initech',
            logo_url: null,
            website_url: null,
            rate: rate({
              numerator: 30,
              denominator: 40,
              denominator_kind: 'observations_with_ai_overview',
              value: 0.75,
            }),
          },
        ],
      }),
    );

    expect(screen.getByText('1 of 40')).toBeVisible();
    expect(screen.getByText('30 of 40')).toBeVisible();
  });
});
