import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { ActiveRun } from '@/lib/visibility/dashboard';
import { renderWithProviders as render } from '@/test/render';

import { ActiveRunBanner } from './active-run-banner';
import { VisibilityEmptyState } from './empty-state';

vi.mock('@/components/runs/launch-audit-button', () => ({
  LaunchAuditButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

/**
 * The three "there is nothing to show yet" surfaces of the Visibility
 * workspace.
 *
 * The distinction that matters: "you have never run an audit" and "your audit
 * is still running" are different situations with different correct actions.
 * Showing the launch CTA to someone whose run is already in flight invites a
 * duplicate, paid run; showing a bare empty state hides the fact that results
 * are on the way.
 */
describe('VisibilityEmptyState', () => {
  it('invites a first audit when nothing is running', () => {
    render(<VisibilityEmptyState />);

    expect(screen.getByText('No completed runs yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Launch your first audit' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'View runs' })).not.toBeInTheDocument();
  });

  it('routes to Runs instead of inviting a duplicate when one is already running', () => {
    render(<VisibilityEmptyState hasActiveRun />);

    // Offering "launch" here would invite a second paid run for results that
    // are already on the way.
    expect(screen.queryByRole('button', { name: /Launch/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View runs' })).toHaveAttribute('href', '/runs');
    expect(screen.getByText(/results appear here when it finishes/i)).toBeVisible();
  });
});

describe('ActiveRunBanner', () => {
  const run: ActiveRun = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'running',
    createdAt: '2026-08-01T00:00:00Z',
  };

  it('names the run’s current status', () => {
    render(<ActiveRunBanner run={run} />);

    expect(screen.getByText(/A run is in progress \(Running\)/)).toBeVisible();
  });

  it('links to that exact run rather than the runs list', () => {
    // An active run has no metric snapshot, so it cannot appear in the run
    // selector; this link is the only way to reach it from here.
    render(<ActiveRunBanner run={run} />);

    expect(screen.getByRole('link', { name: /Watch live progress/ })).toHaveAttribute(
      'href',
      `/runs/${run.id}`,
    );
  });

  it('reflects a different lifecycle status', () => {
    render(<ActiveRunBanner run={{ ...run, status: 'analyzing' }} />);

    expect(screen.getByText(/\(Analyzing\)/)).toBeVisible();
  });
});
