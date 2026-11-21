import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { discovery } from '@/test/fixtures/brand-discovery';
import { renderWithProviders } from '@/test/render';

import { DiscoveryStage } from './onboarding-stages';

describe('DiscoveryStage failure', () => {
  it.each([{ code: 'brand_identity_unavailable', message: 'Research did not finish.' }])(
    'offers the recovery that can lift $code',
    ({ code, message }) => {
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
      expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Run discovery again' })).not.toBeNull();
    },
  );
});
