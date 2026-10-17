import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import type { Audit } from '@/lib/api/types';
import { renderWithProviders as render } from '@/test/render';

import { RunsTable } from './runs-table';

/**
 * The runs list. The list arrives whole and is paginated client-side, so the
 * assertions that matter are that a long history stays navigable and that every
 * row still reaches its own run — a "View" link that loses the id is how a user
 * ends up unable to open the run they just launched.
 */
const PAGE_SIZE = 10;

function audit(index: number, overrides: Partial<Audit> = {}): Audit {
  return {
    id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    workspace_id: '22222222-2222-4222-8222-222222222222',
    project_id: '33333333-3333-4333-8333-333333333333',
    status: 'completed',
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

describe('RunsTable', () => {
  it('links each row to its own run', () => {
    const rows = [audit(1), audit(2)];
    render(<RunsTable audits={rows} />);

    const links = screen.getAllByRole('link', { name: 'View' });
    expect(links[0]).toHaveAttribute('href', `/runs/${rows[0]!.id}`);
    expect(links[1]).toHaveAttribute('href', `/runs/${rows[1]!.id}`);
  });

  it.each([
    ['brand', 'Brand'],
    ['commerce', 'Commerce'],
  ])('distinguishes a %s-scope run', (scope, label) => {
    // Brand and Commerce runs measure different things; a shared list has to
    // say which one a row is.
    render(<RunsTable audits={[audit(1, { audit_scope: scope as Audit['audit_scope'] })]} />);

    expect(screen.getByText(label)).toBeVisible();
  });

  it('renders only a header when there are no runs', () => {
    render(<RunsTable audits={[]} />);

    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('shows every run when the history fits on one page', () => {
    render(<RunsTable audits={Array.from({ length: PAGE_SIZE }, (_, i) => audit(i + 1))} />);

    expect(bodyRows()).toHaveLength(PAGE_SIZE);
  });

  it('caps a long history at one page', () => {
    render(<RunsTable audits={Array.from({ length: 25 }, (_, i) => audit(i + 1))} />);

    expect(bodyRows()).toHaveLength(PAGE_SIZE);
  });

  it('reaches the rest of a long history through pagination', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, i) => audit(i + 1));
    render(<RunsTable audits={rows} />);

    const first = screen.getAllByRole('link', { name: 'View' })[0]!;
    expect(first).toHaveAttribute('href', `/runs/${rows[0]!.id}`);

    await user.click(screen.getByRole('button', { name: /next/i }));

    // Page two starts at the eleventh run, not back at the first.
    const afterPaging = screen.getAllByRole('link', { name: 'View' })[0]!;
    expect(afterPaging).toHaveAttribute('href', `/runs/${rows[PAGE_SIZE]!.id}`);
  });

  it('shows the last, partial page in full', async () => {
    const user = userEvent.setup();
    render(<RunsTable audits={Array.from({ length: 25 }, (_, i) => audit(i + 1))} />);

    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByRole('button', { name: /next/i }));

    // 25 runs over pages of 10 leaves five on the last page.
    expect(bodyRows()).toHaveLength(5);
  });
});
