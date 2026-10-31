import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';
import { makeProject } from '@/test/fixtures/project';

const PROJECT = '88888888-8888-4888-8888-888888888888';
const activeProject = makeProject({
  id: PROJECT,
  workspace_id: '11111111-1111-4111-8111-111111111111',
});

vi.mock('@/components/integrations/data-source-setup', () => ({
  DataSourceSetup: ({ title }: { title: string }) => <section aria-label={title} />,
}));
vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  useProjectContext: () => ({
    activeProject,
    activeWorkspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    isLoading: false,
  }),
}));

import { AiReferralsScreen } from './referrals-screen';

const endpoint = `/api/v1/projects/${PROJECT}/ai-traffic/referrals`;
const dashboard = {
  project_id: PROJECT,
  window_start: '2026-07-20',
  window_end: '2026-07-22',
  granularity: 'day',
  referral_volume: [
    { date: '2026-07-20', value: 4 },
    { date: '2026-07-21', value: 1 },
    { date: '2026-07-22', value: 2 },
  ],
  referral_share: [
    { date: '2026-07-20', value: 0.4 },
    { date: '2026-07-21', value: 0.1 },
    { date: '2026-07-22', value: null },
  ],
  sources: [
    { ai_source: 'chatgpt', sessions: 4, share: 0.2 },
    { ai_source: 'gemini', sessions: 1, share: 0.05 },
  ],
  analyzer_version: 'ai-traffic-v2',
  formula_version: 'ai-referral-sessions-v2',
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('AiReferralsScreen', () => {
  it('keeps range controls available when the selected snapshot is empty', async () => {
    mswServer.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...dashboard,
          referral_volume: [],
          referral_share: [],
          sources: [],
        }),
      ),
    );
    renderWithProviders(<AiReferralsScreen />);

    // GA4 is connected in place rather than through Settings.
    expect(
      await screen.findByRole('region', { name: 'Connect Google Analytics 4' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Range:/ })).toBeVisible();
  });

  it('renders persisted referral measurement by source', async () => {
    mswServer.use(http.get(endpoint, () => HttpResponse.json(dashboard)));
    renderWithProviders(<AiReferralsScreen />);

    expect(await screen.findByText('AI-referred sessions')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Share of GA4 sessions' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getByText('AI referral sources')).toBeInTheDocument();
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });

  it('shows the honest measured-zero state without fabricating a source', async () => {
    mswServer.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...dashboard,
          referral_volume: dashboard.referral_volume.map((point) => ({
            ...point,
            value: 0,
          })),
          referral_share: dashboard.referral_share.map((point) => ({
            ...point,
            value: 0,
          })),
          sources: [],
        }),
      ),
    );
    renderWithProviders(<AiReferralsScreen />);

    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Sources' }));
    expect(
      await screen.findByText(/no sessions matched a known AI source in this window/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Range:/ })).toBeVisible();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('distinguishes incomplete classification from measured zero', async () => {
    mswServer.use(
      http.get(endpoint, () =>
        HttpResponse.json({
          ...dashboard,
          referral_volume: dashboard.referral_volume.map((point) => ({
            ...point,
            value: null,
          })),
          referral_share: dashboard.referral_share.map((point) => ({
            ...point,
            value: null,
          })),
          sources: [],
        }),
      ),
    );
    renderWithProviders(<AiReferralsScreen />);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Sources' }));
    expect(
      await screen.findByText(/classification is not complete for this window/i),
    ).toBeInTheDocument();
  });

  it('keeps the chart and keyboard focus while the interval refetches', async () => {
    let releaseMonth: ((response: Response) => void) | undefined;
    mswServer.use(
      http.get(endpoint, ({ request }) => {
        if (new URL(request.url).searchParams.get('granularity') !== 'month') {
          return HttpResponse.json(dashboard);
        }
        return new Promise<Response>((resolve) => {
          releaseMonth = resolve;
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<AiReferralsScreen />);

    expect(await screen.findAllByText('3 days')).toHaveLength(2);
    const month = screen.getByRole('radio', { name: 'Month' });
    await user.click(month);

    expect(month).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Updating data… Previous data shown.');
    expect(screen.getAllByText('3 days')).toHaveLength(2);

    releaseMonth?.(
      HttpResponse.json({
        ...dashboard,
        granularity: 'month',
        referral_volume: [{ date: '2026-07-20', value: 7 }],
        referral_share: [{ date: '2026-07-20', value: 0.35 }],
      }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
    expect(screen.getAllByText('1 month')).toHaveLength(2);
  });
});
