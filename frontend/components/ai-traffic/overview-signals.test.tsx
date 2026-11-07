import { screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';
import { renderWithProviders } from '@/test/render';
import { CitationSignal, CrawlSignalPanel } from './overview-signals';

const projectId = '88888888-8888-4888-8888-888888888888';
const crawl = {
  unit: 'requests' as const,
  identity_level: 'path' as const,
  connection: 'connected' as const,
  coverage: 'partial' as const,
  reporting_timezone: 'UTC',
  last_processed_at: null,
  requests: null,
  pages: null,
  active_bots: null,
  error_share: null,
  failed_verification_requests: null,
  series: [],
};

it('keeps unavailable, missing, awaiting, incomplete and measured zero distinct', () => {
  const view = renderWithProviders(
    <CrawlSignalPanel available={false} data={{ ...crawl, connection: 'not_connected' }} />,
  );
  expect(screen.getByText(/not available for this workspace yet/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
  view.rerender(<CrawlSignalPanel available data={{ ...crawl, connection: 'not_connected' }} />);
  expect(screen.getByRole('button', { name: 'Connect crawl logs' })).toBeEnabled();
  view.rerender(<CrawlSignalPanel available data={{ ...crawl, connection: 'awaiting_data' }} />);
  expect(screen.getByText(/Awaiting the first accepted batch/)).toBeVisible();
  view.rerender(<CrawlSignalPanel available data={crawl} />);
  expect(screen.getByText(/No matching requests were observed/)).toBeVisible();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  view.rerender(
    <CrawlSignalPanel
      available
      data={{ ...crawl, coverage: 'complete', requests: 0, pages: 0, active_bots: 0 }}
    />,
  );
  expect(screen.getByText('0')).toBeVisible();
  expect(screen.queryByText(/No matching requests were observed/)).not.toBeInTheDocument();
});

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
