import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { discovery } from '@/test/fixtures/brand-discovery';
import { renderWithProviders } from '@/test/render';

import { DiscoveryStage } from './onboarding-stages';

describe('DiscoveryStage failure', () => {
  it.each([
    { code: 'ai_credits_exhausted', message: 'Out of AI credits.', plans: true },
    { code: 'brand_identity_unavailable', message: 'Research did not finish.', plans: false },
  ])('offers the recovery that can lift $code', ({ code, message, plans }) => {
    const failed = {
      ...discovery('failed', 'preparing_review'),
      warnings: ['research_degraded'],
      error_code: code,
    };
    renderWithProviders(
      <DiscoveryStage
        discovery={{ discovery: failed, error: null, isRunning: false, retry: () => {} }}
        onEdit={() => {}}
        onRerun={() => {}}
        actions={{ next: null }}
      />,
    );
    expect(screen.getByText(message)).toBeInTheDocument();
    const link = screen.queryByRole('link', { name: 'See plans' });
    const rerun = screen.queryByRole('button', { name: 'Run discovery again' });
    expect([link?.getAttribute('href') ?? null, rerun !== null]).toEqual(
      plans ? ['/billing', false] : [null, true],
    );
  });
});
