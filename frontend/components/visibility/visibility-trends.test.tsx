import { screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import type { SurfaceRates, Visibility, VisibilityTrendPoint } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { VisibilityTrends } from './visibility-trends';

const failed = (error: Error) =>
  ({
    data: undefined,
    error,
    isError: true,
    isFetching: false,
    refetch: vi.fn(),
  }) as unknown as UseQueryResult<Visibility | null>;

function renderTrends(visibilityQuery: UseQueryResult<Visibility | null>) {
  render(
    <VisibilityTrends
      query={{ data: [], isError: false } as unknown as UseQueryResult<VisibilityTrendPoint[]>}
      visibilityQuery={visibilityQuery}
      engineFilter="all"
      surfaceRatesQuery={{ data: undefined } as unknown as UseQueryResult<SurfaceRates>}
      surfaceEngine={null}
      hasRuns
      isFiltered={false}
    />,
  );
}

describe('Visibility trends', () => {
  it('says nothing is measured for a selection with no measured run', () => {
    renderTrends({ data: null, isError: false } as UseQueryResult<Visibility | null>);
    expect(screen.getByText('No measured run for this selection yet.')).toBeVisible();
    expect(screen.queryByText(/still being prepared/u)).toBeNull();
  });

  it('says results are still being prepared while the run is written', () => {
    renderTrends(
      failed(
        new ApiError('Metrics not available for audit', 404, '', undefined, {
          code: 'visibility_metrics_pending',
        }),
      ),
    );
    expect(
      screen.getByText(
        'Results for this run are still being prepared. They appear here as soon as they are ready.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows a run that does not exist as a failed read, with a retry', () => {
    renderTrends(
      failed(new ApiError('Audit not found', 404, '', undefined, { code: 'not_found' })),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeVisible();
    expect(screen.queryByText('No measured run for this selection yet.')).toBeNull();
  });
});
