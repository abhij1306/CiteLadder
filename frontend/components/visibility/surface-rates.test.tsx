import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders as render } from '@/test/render';
import type { AioRate, SurfaceRates } from '@/lib/api/types';

import { SurfaceRatesPanel } from './surface-rates';

/**
 * A rate published without its denominator gets read as whichever rate the
 * reader already had in mind, and a rate with nothing to divide is UNKNOWN,
 * not zero. Both failures are silent — the number looks fine either way — so
 * they are what this file locks down.
 */

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

    // The worked example: 100 observations, 40 overviews, 10 naming the brand.
    // All three are true and none of them alone is "how visible are we".
    expect(screen.getByText('40%')).toBeVisible();
    expect(screen.getByText('25%')).toBeVisible();
    expect(screen.getByText('10%')).toBeVisible();
  });

  it('states what each number divided by', () => {
    panel(rates());

    expect(screen.getByText('40 of 100 searches we successfully observed')).toBeVisible();
    expect(screen.getByText('10 of 40 searches that showed an overview')).toBeVisible();
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
            rate: rate({
              numerator: 1,
              denominator: 40,
              denominator_kind: 'observations_with_ai_overview',
              value: 0.025,
            }),
          },
          {
            name: 'Initech',
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

    // The shared denominator is stated once above the list, but the
    // numerators are what separate these two. Percentages alone made a
    // competitor named in one overview look like the same kind of claim as
    // one named in thirty.
    expect(screen.getByText('1 of 40')).toBeVisible();
    expect(screen.getByText('30 of 40')).toBeVisible();
  });
});
