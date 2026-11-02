import { screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';
import { renderWithProviders } from '@/test/render';
import { CitationSignal } from './overview-signals';

const projectId = '88888888-8888-4888-8888-888888888888';

it('shows a measured zero as 0 and a window with no completed run as not available yet', () => {
  const { unmount } = renderWithProviders(
    <CitationSignal
      projectId={projectId}
      data={{
        unit: 'tracked_citations',
        state: 'measured',
        count: 0,
        label: 'Tracked answers',
        sources: [{ audit_id: '99999999-9999-4999-8999-999999999999', analyzer_version: '1' }],
      }}
    />,
  );
  expect(screen.getByText('0')).toBeVisible();
  expect(screen.queryByText('Not available yet')).not.toBeInTheDocument();
  unmount();

  renderWithProviders(
    <CitationSignal
      projectId={projectId}
      data={{
        unit: 'tracked_citations',
        state: 'not_available',
        reason: 'no_completed_run',
        count: null,
        label: 'Tracked answers',
      }}
    />,
  );
  expect(screen.getByText('No AI Visibility run completed in this window.')).toBeVisible();
  expect(screen.getAllByText('Not available yet').length).toBe(2);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
