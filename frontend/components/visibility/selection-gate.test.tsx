import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import type { Visibility } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { SelectionGate } from './selection-gate';

const RUN_ID = '00000000-0000-4000-8000-000000000001';

/** The selection projection as the dashboard reads it, answered by `answer`. */
function Gate({ answer }: Readonly<{ answer: () => Promise<Visibility | null> }>) {
  const query = useQuery({ queryKey: ['selection-gate-test'], queryFn: answer });
  return (
    <SelectionGate query={query}>
      {(selected) => <p>Measured run {selected.audit_id}</p>}
    </SelectionGate>
  );
}

const projection = (extra: Partial<Visibility> = {}) =>
  ({ audit_id: RUN_ID, rankings: [], per_engine: [], ...extra }) as unknown as Visibility;

const never = () =>
  new Promise<never>(() => {
    // Never settles: the selection stays unread.
  });

/**
 * Every Visibility tab reads through this gate, so what it shows for a
 * selection nobody has read decides whether a tab can claim "no mentions" or
 * "no sources" about it.
 */
describe('SelectionGate', () => {
  it('shows a loading selection as loading, never as a finding', async () => {
    render(<Gate answer={never} />);

    expect(
      await screen.findByRole('status', { name: 'Loading the selected measurement…' }),
    ).toBeVisible();
    expect(screen.queryByText(/Measured run/u)).toBeNull();
  });

  it('reports a failed selection read with a retry for it', async () => {
    render(
      <Gate
        answer={() =>
          Promise.reject(new ApiError('Audit not found', 404, '', undefined, { code: 'not_found' }))
        }
      />,
    );

    expect(await screen.findByText("Couldn't load the selected measurement")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByText('Not measured yet')).toBeNull();
  });

  it('says results are being prepared while a finished run is still written, with no retry', async () => {
    render(
      <Gate
        answer={() =>
          Promise.reject(
            new ApiError('Metrics not available for audit', 404, '', undefined, {
              code: 'visibility_metrics_pending',
            }),
          )
        }
      />,
    );

    expect(
      await screen.findByText(
        'Results for this run are still being prepared. They appear here as soon as they are ready.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says nothing is measured yet for a selection with no measured run', async () => {
    render(<Gate answer={() => Promise.resolve(null)} />);

    expect(await screen.findByText('Not measured yet')).toBeVisible();
    expect(
      screen.getByText('Results appear here once a run in this selection finishes measuring.'),
    ).toBeVisible();
  });

  it.each([
    ['pooled no runs', []],
    ['lists no pooled runs', undefined],
  ])('treats a period that %s as not measured', async (_case, sourceAuditIds) => {
    render(
      <Gate
        answer={() =>
          Promise.resolve(projection({ selection_mode: 'range', source_audit_ids: sourceAuditIds }))
        }
      />,
    );

    expect(await screen.findByText('Not measured yet')).toBeVisible();
    expect(screen.queryByText(/Measured run/u)).toBeNull();
  });

  it('hands a measured selection to the tab', async () => {
    render(
      <Gate
        answer={() =>
          Promise.resolve(projection({ selection_mode: 'range', source_audit_ids: [RUN_ID] }))
        }
      />,
    );

    expect(await screen.findByText(`Measured run ${RUN_ID}`)).toBeVisible();
    expect(screen.queryByText('Not measured yet')).toBeNull();
  });
});
