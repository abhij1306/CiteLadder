import { screen } from '@testing-library/react';

import { renderWithProviders as render } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Audit } from '@citeladder/contracts';

import { ProgressPanel, RunActions } from './progress-panel';

const BASE_AUDIT: Audit = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  project_id: '33333333-3333-4333-8333-333333333333',
  parent_audit_id: null,
  status: 'running',
  cancelable: true,
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

  it.each(['reporting', 'completed', 'failed'] as const)(
    'offers no Cancel once the run is %s, which the backend would reject',
    (status) => {
      renderPanel({ status, cancelable: false, failed_count: 2 }, { onRerunFailures: vi.fn() });
      expect(screen.queryByRole('button', { name: /Cancel run|Cancelling/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Rerun failed' })).toBeEnabled();
    },
  );

  it('fires the cancel callback exactly once per click', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderPanel({ status: 'running' });

    await user.click(cancelButton());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel and says so while a cancel is in flight', () => {
    renderPanel({ status: 'running' }, { cancelPending: true });

    expect(cancelButton()).toBeDisabled();
    expect(screen.getByText('Cancelling…')).toBeVisible();
  });

  it('says when the run started by time only: the masthead title carries its day', () => {
    renderPanel({ status: 'running' });

    expect(screen.getByText('Started 12:00 AM')).toBeVisible();
    expect(screen.queryByText(/Aug 1, 2026/)).toBeNull();
  });

  it('counts failed answers as finished in the progress percentage', () => {
    renderPanel({ status: 'running', requested_count: 60, completed_count: 40, failed_count: 19 });

    expect(screen.getByText('98.0%')).toBeVisible();
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
