import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Audit } from '@/lib/api/types';

import { ProgressPanel, RunActions } from './progress-panel';

/**
 * `components/runs` shipped with no colocated tests. The run lifecycle surface
 * is the one place a user can stop work that costs money, so the assertions
 * that matter are about the Cancel affordance: it must be live while — and only
 * while — the backend would still accept a cooperative cancel. `reporting` is
 * deliberately NOT cancelable (execution and analysis are already done), which
 * is exactly the boundary a rendering test can pin.
 */
const BASE_AUDIT: Audit = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  project_id: '33333333-3333-4333-8333-333333333333',
  parent_audit_id: null,
  status: 'running',
  benchmark_mode: 'consumer_like',
  audit_scope: 'brand',
  model_provenance: [],
  repetitions: 1,
  random_seed: 'seed',
  requested_count: 12,
  completed_count: 5,
  failed_count: 0,
  error_message: '',
  engine_snapshots: [],
  market: { id: null, country_code: 'US', language_code: 'en' },
  launch_id: null,
  not_applicable_engines: [],
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:01:00Z',
  started_at: '2026-08-01T00:00:10Z',
  completed_at: null,
};

/** The run route renders the actions in its identity band beside the panel. */
function renderPanel(
  audit: Partial<Audit> = {},
  props: { cancelPending?: boolean; onRerunFailures?: () => void; rerunPending?: boolean } = {},
) {
  const onCancel = vi.fn();
  const run = { ...BASE_AUDIT, ...audit };
  render(
    <>
      <RunActions
        audit={run}
        onCancel={onCancel}
        cancelPending={false}
        onExport={vi.fn()}
        exporting={null}
        {...props}
      />
      <ProgressPanel audit={run} />
    </>,
  );
  return { onCancel };
}

const cancelButton = () => screen.getByRole('button', { name: /Cancel run|Cancelling/ });

describe('ProgressPanel', () => {
  it('allows Cancel while running but not once reporting, which the backend would reject', () => {
    renderPanel({ status: 'running' });
    expect(cancelButton()).toBeEnabled();
  });

  it('disables Cancel once the run is reporting', () => {
    renderPanel({ status: 'reporting' });
    expect(cancelButton()).toBeDisabled();
  });

  it('fires the cancel callback exactly once per click', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderPanel({ status: 'running' });

    await user.click(cancelButton());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel and says so while a cancel is in flight', () => {
    renderPanel({ status: 'running' }, { cancelPending: true });

    // Prevents a second cancel request against an already-cancelling run.
    expect(cancelButton()).toBeDisabled();
    expect(screen.getByText('Cancelling…')).toBeVisible();
  });

  it('shows the updating indicator while reporting and hides it once completed', () => {
    const { unmount } = render(<ProgressPanel audit={{ ...BASE_AUDIT, status: 'reporting' }} />);
    expect(screen.getByText('Updating…')).toBeVisible();
    unmount();
    render(<ProgressPanel audit={{ ...BASE_AUDIT, status: 'completed' }} />);
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('offers authenticated export actions for both formats', () => {
    renderPanel();

    for (const name of ['Export CSV', 'Export MD']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('offers a failure rerun only when there is a failure to rerun', async () => {
    const user = userEvent.setup();
    const onRerunFailures = vi.fn();
    renderPanel({ failed_count: 3 }, { onRerunFailures });

    await user.click(screen.getByRole('button', { name: 'Rerun failed' }));

    expect(onRerunFailures).toHaveBeenCalledTimes(1);
  });

  it('hides the failure rerun when nothing failed', () => {
    renderPanel({ failed_count: 0 }, { onRerunFailures: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Rerun failed' })).not.toBeInTheDocument();
  });

  it('hides the failure rerun when no handler is supplied', () => {
    renderPanel({ failed_count: 3 });

    expect(screen.queryByRole('button', { name: 'Rerun failed' })).not.toBeInTheDocument();
  });

  it('disables the rerun while one is being created', () => {
    renderPanel({ failed_count: 3 }, { onRerunFailures: vi.fn(), rerunPending: true });

    expect(screen.getByRole('button', { name: 'Creating repair…' })).toBeDisabled();
  });

  it('surfaces a run error message', () => {
    renderPanel({ status: 'failed', error_message: 'Provider budget exhausted' });

    expect(screen.getByText('Provider budget exhausted')).toBeVisible();
  });

  it('renders no error paragraph when the run carries none', () => {
    renderPanel({ error_message: '' });

    expect(screen.queryByText(/Provider budget/)).not.toBeInTheDocument();
  });
});
