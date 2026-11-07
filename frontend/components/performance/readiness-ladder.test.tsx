import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';

import { ReadinessLadder } from './readiness-ladder';

const failedImport = {
  project_id: '44444444-4444-4444-8444-444444444444',
  stage: 'import_failed' as const,
  connection_count: 1,
  providers: ['gsc' as const],
  backfill_state: 'failed',
  imported_through: null,
  has_performance_snapshot: false,
  has_demand_snapshot: false,
  opportunity_count: 0,
};

it('recovers a failed history import with Sync again', () => {
  let syncs = 0;
  render(
    <ReadinessLadder
      data={failedImport}
      sync={() => {
        syncs += 1;
      }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The history import finished without importing anything.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sync again' }));
  expect(syncs).toBe(1);
});
