import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { ApiError } from '@/lib/api/errors';
import { runsApi } from '@/lib/api/runs';
import { renderWithProviders } from '@/test/render';

import { AuditSchedules } from './audit-schedules';

vi.mock('@/lib/api/runs', () => ({
  runsApi: {
    listSchedules: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
  },
}));

const createSchedule = vi.mocked(runsApi.createSchedule);
const listSchedules = vi.mocked(runsApi.listSchedules);
const updateSchedule = vi.mocked(runsApi.updateSchedule);
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let workspaceId = WORKSPACE_ID;

vi.mock('@/lib/project/project-context', () => ({
  useActiveWorkspaceId: () => workspaceId,
}));

describe('AuditSchedules', () => {
  beforeEach(() => {
    workspaceId = WORKSPACE_ID;
    createSchedule.mockReset();
    listSchedules.mockReset();
    updateSchedule.mockReset();
    listSchedules.mockResolvedValue([]);
    createSchedule.mockResolvedValue(null as never);
  });

  it('preserves the schedule payload while shared controls own its inputs', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AuditSchedules
        projectId="11111111-1111-4111-8111-111111111111"
        promptSets={[{ id: '22222222-2222-4222-8222-222222222222', name: 'Core prompts' } as never]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Cadence' }));
    await user.click(screen.getByRole('option', { name: 'Every N minutes' }));
    await user.clear(screen.getByLabelText('Minutes'));
    await user.type(screen.getByLabelText('Minutes'), '15');
    await user.click(screen.getByRole('checkbox', { name: 'Gemini API' }));
    await user.click(screen.getByRole('button', { name: 'Schedule audit' }));

    await waitFor(() =>
      expect(createSchedule).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({
          prompt_set_id: '22222222-2222-4222-8222-222222222222',
          audit_scope: 'brand',
          cadence: 'every_n_minutes',
          interval_minutes: 15,
          engines: ['chatgpt', 'gemini'],
        }),
        { workspaceId: WORKSPACE_ID },
      ),
    );
    await waitFor(() => expect(listSchedules).toHaveBeenCalledTimes(2));
  });

  it('reports a failed schedules read without calling the list empty', async () => {
    listSchedules.mockRejectedValue(new ApiError('Schedules are unavailable.', 400, ''));
    renderWithProviders(
      <AuditSchedules projectId="11111111-1111-4111-8111-111111111111" promptSets={[]} />,
    );
    expect(await screen.findByText('Schedules are unavailable.')).toBeVisible();
    expect(screen.queryByText('No scheduled audits yet.')).toBeNull();
  });

  it('offers no Resume for a one-time schedule that already ran', async () => {
    listSchedules.mockResolvedValue([
      {
        id: '55555555-5555-4555-8555-555555555555',
        cadence: 'one_time',
        engines: ['chatgpt'],
        enabled: false,
        failure_count: 0,
        last_error: '',
        audit_scope: 'brand',
        next_run_at: null,
      } as never,
    ]);
    renderWithProviders(
      <AuditSchedules projectId="11111111-1111-4111-8111-111111111111" promptSets={[]} />,
    );
    expect(await screen.findByText(/Ran once/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('resumes a paused schedule by enabling it, after saying why it paused', async () => {
    const user = userEvent.setup();
    const projectId = '11111111-1111-4111-8111-111111111111';
    listSchedules.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        cadence: 'weekly',
        engines: ['chatgpt'],
        enabled: false,
        failure_count: 3,
        last_error: 'execution_credentials_unavailable',
        audit_scope: 'brand',
        next_run_at: null,
      } as never,
    ]);
    updateSchedule.mockResolvedValue(null as never);
    renderWithProviders(<AuditSchedules projectId={projectId} promptSets={[]} />);

    expect(await screen.findByText(/Paused/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith(
        projectId,
        '44444444-4444-4444-8444-444444444444',
        { enabled: true },
        { workspaceId: WORKSPACE_ID },
      ),
    );
  });

  it('does not reuse a fresh schedules cache entry after a workspace transition', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const otherWorkspace = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const view = () => <AuditSchedules projectId={projectId} promptSets={[]} />;
    const { rerender } = renderWithProviders(view());
    await screen.findByText('No scheduled audits yet.');
    let release!: (schedules: Awaited<ReturnType<typeof runsApi.listSchedules>>) => void;
    listSchedules.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    workspaceId = otherWorkspace;
    rerender(view());
    await waitFor(() =>
      expect(listSchedules).toHaveBeenCalledWith(projectId, {
        signal: expect.any(AbortSignal),
        workspaceId: otherWorkspace,
      }),
    );
    expect(screen.queryByText('No scheduled audits yet.')).not.toBeInTheDocument();
    release([]);
    await screen.findByText('No scheduled audits yet.');
    workspaceId = WORKSPACE_ID;
    rerender(view());
    expect(screen.getByText('No scheduled audits yet.')).toBeVisible();
    expect(listSchedules).toHaveBeenCalledTimes(2);
  });
});
