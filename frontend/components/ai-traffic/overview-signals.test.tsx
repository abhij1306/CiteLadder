import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, onTestFinished, vi } from 'vite-plus/test';
import { renderWithProviders } from '@/test/render';
import { OverviewFigures } from './overview-signals';

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
const referrals = {
  project_id: projectId,
  window_start: null,
  window_end: null,
  granularity: 'day' as const,
  referral_volume: [],
  referral_share: [],
  sources: [],
  analyzer_version: '1',
  formula_version: '1',
  scope: 'property-wide' as const,
  reporting_timezone: null,
  currency_code: null,
  analytics_quality: {},
  unattributed_landing: null,
  source_measures: [],
  channel_comparison: [],
  landing_pages: [],
};
const citations = {
  unit: 'tracked_citations' as const,
  state: 'measured' as const,
  count: 7,
  label: 'Tracked answers',
  sources: [{ audit_id: '99999999-9999-4999-8999-999999999999', analyzer_version: '1' }],
};
type Overview = React.ComponentProps<typeof OverviewFigures>['data'];

type Ga4Step = React.ComponentProps<typeof OverviewFigures>['ga4'];
const ga4Connection = {
  id: '77777777-7777-4777-8777-777777777777',
  workspace_id: '66666666-6666-4666-8666-666666666666',
  grant_id: '55555555-5555-4555-8555-555555555555',
  provider: 'ga4' as const,
  label: '',
  account_ref: '',
  grant_status: 'connected' as const,
  granted_scopes: [],
  last_synced_at: null,
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

const connectCrawl = vi.fn();

function figures(
  overrides: Partial<Overview>,
  crawlAvailable = true,
  ga4: Ga4Step = { kind: 'connect' },
) {
  return (
    <OverviewFigures
      projectId={projectId}
      crawlAvailable={crawlAvailable}
      ga4={ga4}
      onConnectCrawl={connectCrawl}
      data={{ crawl, referrals, citations, ...overrides }}
    />
  );
}
const figure = (label: string) =>
  screen.getByText(label).closest('[data-figure-cell]') as HTMLElement;
const whyAbsent = (label: string) => screen.getByRole('button', { name: `About ${label}` });
const basis = (label: string) => screen.getByRole('button', { name: `Basis of ${label}` });

it('keeps unavailable, missing, awaiting, incomplete and measured zero distinct', () => {
  const view = renderWithProviders(
    figures({ crawl: { ...crawl, connection: 'not_connected' } }, false),
  );
  expect(whyAbsent('Crawler requests')).toHaveAccessibleDescription(
    /not available for this workspace yet/,
  );
  expect(screen.queryByRole('button', { name: 'Connect crawl logs' })).not.toBeInTheDocument();
  view.rerender(figures({ crawl: { ...crawl, connection: 'not_connected' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Connect crawl logs' }));
  expect(connectCrawl).toHaveBeenCalledOnce();
  view.rerender(figures({ crawl: { ...crawl, connection: 'awaiting_data' } }));
  expect(whyAbsent('Crawler requests')).toHaveAccessibleDescription(
    /Awaiting the first accepted batch/,
  );
  view.rerender(figures({ crawl }));
  expect(whyAbsent('Crawler requests')).toHaveAccessibleDescription(
    /No matching requests were observed/,
  );
  expect(within(figure('Crawler requests')).queryByText('0')).not.toBeInTheDocument();
  view.rerender(
    figures({ crawl: { ...crawl, coverage: 'complete', requests: 0, pages: 0, active_bots: 0 } }),
  );
  expect(within(figure('Crawler requests')).getByText('0')).toBeVisible();
  expect(within(figure('Path-level pages')).getByText('0')).toBeVisible();
  expect(screen.queryByText(/No matching requests were observed/)).not.toBeInTheDocument();
});

it('keeps failed verification requests and unavailable active bots visible', () => {
  const view = renderWithProviders(
    figures({ crawl: { ...crawl, failed_verification_requests: 3 } }),
  );
  expect(whyAbsent('Crawler requests')).toHaveAccessibleDescription(
    'No matching requests were observed. Coverage is incomplete. 3 failed verification requests shown separately.',
  );
  view.rerender(figures({ crawl: { ...crawl, requests: 12, pages: 4, active_bots: null } }));
  expect(basis('Path-level pages')).toHaveAccessibleDescription(/Active bots unavailable/);
  view.rerender(figures({ crawl: { ...crawl, requests: 12, pages: 4, active_bots: 2 } }));
  expect(basis('Path-level pages')).toHaveAccessibleDescription(/Requested by 2 active bots/);
});

it('shows a measured zero as 0 and a window with no completed run as not run yet', () => {
  const { unmount } = renderWithProviders(figures({ citations: { ...citations, count: 0 } }));
  expect(within(figure('Tracked citations')).getByText('0')).toBeVisible();
  expect(within(figure('Tracked citations')).queryByText('Not run yet')).not.toBeInTheDocument();
  unmount();

  renderWithProviders(
    figures({
      citations: {
        unit: 'tracked_citations',
        state: 'not_available',
        reason: 'no_completed_run',
        count: null,
        label: 'Tracked answers',
      },
    }),
  );
  const cell = within(figure('Tracked citations'));
  expect(basis('Tracked citations')).toHaveAccessibleDescription(
    /No visibility run completed in this window\./,
  );
  expect(cell.getByText('Not run yet')).toBeVisible();
  expect(cell.queryByText('0')).not.toBeInTheDocument();
});

it("offers GA4's own next step once, under the figures, until a referral snapshot exists", () => {
  const view = renderWithProviders(figures({}));
  const referral = within(figure('AI referral sessions'));
  expect(referral.getByText('Not connected')).toBeVisible();
  expect(referral.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Connect GA4' })).toHaveLength(1);
  expect(screen.queryByText(/GA4 · Synced/)).not.toBeInTheDocument();

  view.rerender(figures({}, true, { kind: 'choose', connection: ga4Connection }));
  expect(within(figure('AI referral sessions')).getByText('Not set')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Choose GA4 property' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
  view.rerender(figures({}, true, null));
  expect(within(figure('AI referral sessions')).getByText('Unavailable')).toBeVisible();
  expect(whyAbsent('AI referral sessions')).toHaveAccessibleDescription(
    'Referral sessions appear once GA4 imports a report.',
  );
  expect(screen.queryByRole('link', { name: /GA4/ })).not.toBeInTheDocument();

  document.cookie = 'citeladder-display-timezone=America%2FNew_York; path=/';
  onTestFinished(() => {
    document.cookie = 'citeladder-display-timezone=; path=/; max-age=0';
  });
  view.rerender(
    figures({
      referrals: {
        ...referrals,
        window_start: '2026-07-20',
        window_end: '2026-07-22',
        referral_volume: [{ date: '2026-07-22', value: 0 }],
        referral_share: [{ date: '2026-07-22', value: 0 }],
      },
    }),
  );
  const cell = within(figure('AI referral sessions'));
  expect(cell.getByText('0')).toBeVisible();
  expect(basis('AI referral sessions')).toHaveAccessibleDescription(/GA4 · Synced/);
  expect(basis('AI referral sessions')).toHaveAccessibleDescription(/Jul 22, 2026/);
  expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
});
