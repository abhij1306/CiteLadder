import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import type { Audit } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { RunsTable } from './runs-table';

const PAGE_SIZE = 10;

function audit(index: number, overrides: Partial<Audit> = {}): Audit {
  return {
    id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    workspace_id: '22222222-2222-4222-8222-222222222222',
    project_id: '33333333-3333-4333-8333-333333333333',
    status: 'completed',
    cancelable: false,
    benchmark_mode: 'consumer_like',
    audit_scope: 'brand',
    model_provenance: [],
    repetitions: 1,
    random_seed: 'seed',
    requested_count: 10,
    completed_count: 10,
    failed_count: 0,
    error_message: '',
    engine_snapshots: [],
    market: { id: null, country_code: 'US', language_code: 'en' },
    launch_id: null,
    not_applicable_engines: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:01:00Z',
    started_at: '2026-08-01T00:00:01Z',
    completed_at: '2026-08-01T00:00:30Z',
    ...overrides,
  } as Audit;
}

const bodyRows = () => screen.getAllByRole('row').slice(1);

function renderTable(audits: Audit[]) {
  return render(<RunsTable audits={audits} status={null} emptyHeading="No failed runs" />);
}

const runLinks = () => screen.getAllByRole('link', { name: /audit|repair run/ });

describe('RunsTable', () => {
  it('names each row by its run and links it to that run', () => {
    const rows = [audit(1), audit(2, { created_at: '2026-07-30T00:00:00Z' })];
    renderTable(rows);

    const links = runLinks();
    expect(links[0]).toHaveAccessibleName('Brand audit · Aug 1, 2026');
    expect(links[0]).toHaveAttribute('href', `/runs/${rows[0]!.id}`);
    expect(links[1]).toHaveAccessibleName('Brand audit · Jul 30, 2026');
    expect(links[1]).toHaveAttribute('href', `/runs/${rows[1]!.id}`);
  });

  it.each([
    [{ audit_scope: 'brand' }, 'Brand audit · Aug 1, 2026'],
    [{ audit_scope: 'commerce' }, 'Commerce audit · Aug 1, 2026'],
    [
      { audit_scope: 'brand', parent_audit_id: '99999999-1111-4111-8111-111111111111' },
      'Brand repair run · Aug 1, 2026',
    ],
  ] as const)('distinguishes a run by what it measured (%o)', (overrides, name) => {
    renderTable([audit(1, overrides)]);

    expect(screen.getByRole('link', { name })).toBeVisible();
  });

  it('sorts by a column on its header and marks the sorted column', async () => {
    const user = userEvent.setup();
    renderTable([
      audit(1, { failed_count: 0 }),
      audit(2, { failed_count: 7, created_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(runLinks()[0]).toHaveAttribute('href', `/runs/${audit(1).id}`);
    expect(screen.getByRole('columnheader', { name: /Run/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await user.click(screen.getByRole('button', { name: /Failed/ }));

    expect(runLinks()[0]).toHaveAttribute('href', `/runs/${audit(2).id}`);
    expect(screen.getByRole('columnheader', { name: /Failed/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /Run/ })).not.toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(window.location.search).toBe('?sort=-failed');
    cleanup();
    renderTable([
      audit(1, { failed_count: 0 }),
      audit(2, { failed_count: 7, created_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(runLinks()[0]).toHaveAttribute('href', `/runs/${audit(2).id}`);
  });

  it('returns to the first page when the sort changes', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, i) => audit(i + 1, { failed_count: i }));
    renderTable(rows);
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(window.location.search).toBe('?page=2');

    await user.click(screen.getByRole('button', { name: /Failed/ }));
    expect(window.location.search).toBe('?sort=-failed');

    expect(runLinks()[0]).toHaveAttribute('href', `/runs/${rows[24]!.id}`);
  });

  it('gives way to one empty state, head included, when there are no runs', () => {
    renderTable([]);

    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'No failed runs' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /audit/ })).toBeNull();
  });

  it('shows every run when the history fits on one page', () => {
    renderTable(Array.from({ length: PAGE_SIZE }, (_, i) => audit(i + 1)));

    expect(bodyRows()).toHaveLength(PAGE_SIZE);
  });

  it('caps a long history at one page', () => {
    renderTable(Array.from({ length: 25 }, (_, i) => audit(i + 1)));

    expect(bodyRows()).toHaveLength(PAGE_SIZE);
  });

  it('reaches the rest of a long history through pagination', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, i) => audit(i + 1));
    renderTable(rows);

    const first = runLinks()[0]!;
    expect(first).toHaveAttribute('href', `/runs/${rows[0]!.id}`);

    await user.click(screen.getByRole('button', { name: /next/i }));

    const afterPaging = runLinks()[0]!;
    expect(afterPaging).toHaveAttribute('href', `/runs/${rows[PAGE_SIZE]!.id}`);
  });

  it('shows the last, partial page in full', async () => {
    const user = userEvent.setup();
    renderTable(Array.from({ length: 25 }, (_, i) => audit(i + 1)));

    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(bodyRows()).toHaveLength(5);
  });

  it('announces the polling note in a live region that was mounted while idle', () => {
    const { rerender } = renderTable([audit(1)]);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    rerender(<RunsTable audits={[audit(1)]} status="Updating" emptyHeading="No failed runs" />);

    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Updating');
  });
});
