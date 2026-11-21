import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { Audit } from '@citeladder/contracts';
import { promptsApi } from '@/lib/api/prompts';
import { runsApi } from '@/lib/api/runs';
import { makeProject } from '@/test/fixtures/project';
import { makePrompt, makeSet, makeSetList } from '@/test/fixtures/prompts';
import { renderWithProviders } from '@/test/render';

import { RunsScreen } from './runs-screen';

const project = makeProject();

function audit(n: number, status: Audit['status'], created_at: string): Audit {
  return {
    id: `0000000${n}-1111-4111-8111-111111111111`,
    workspace_id: project.workspace_id,
    project_id: project.id,
    parent_audit_id: null,
    status,
    cancelable: false,
    benchmark_mode: 'consumer_like',
    audit_scope: 'brand',
    model_provenance: [],
    repetitions: 1,
    random_seed: 'seed',
    requested_count: 10,
    completed_count: status === 'failed' ? 0 : 10,
    failed_count: status === 'failed' ? 10 : 0,
    error_message: '',
    engine_snapshots: [],
    market: { id: null, country_code: 'US', language_code: 'en' },
    launch_id: null,
    not_applicable_engines: [],
    created_at,
    updated_at: created_at,
    started_at: created_at,
    completed_at: created_at,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

it('opens on the status a deep link names', async () => {
  vi.spyOn(runsApi, 'listAudits').mockResolvedValue([
    audit(1, 'completed', '2026-08-01T00:00:00Z'),
    audit(2, 'failed', '2026-07-30T00:00:00Z'),
  ]);
  vi.spyOn(runsApi, 'listSchedules').mockResolvedValue([]);
  window.history.replaceState(null, '', `/projects/${project.id}/runs?status=failed`);
  renderWithProviders(<RunsScreen />, {
    projectSelection: {
      projects: [project],
      activeProject: project,
      activeProjectId: project.id,
      status: 'ready',
    },
  });

  const table = within(await screen.findByRole('table', { name: 'All runs' }));
  expect(table.getByRole('link', { name: 'Brand audit · Jul 30, 2026' })).toBeVisible();
  expect(table.queryByRole('link', { name: 'Brand audit · Aug 1, 2026' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Failed/ })).toHaveAttribute('aria-selected', 'true');
});

it.each([
  ['no active prompt', 'archived', { role: 'link', name: 'Add prompts' }, false],
  ['an active prompt', 'active', { role: 'button', name: 'Launch run' }, true],
] as const)(
  'with no run and %s, the empty state carries the next step and no status tabs',
  async (_label, status, next, schedules) => {
    vi.spyOn(runsApi, 'listAudits').mockResolvedValue([]);
    vi.spyOn(runsApi, 'listSchedules').mockResolvedValue([]);
    vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(
      makeSetList([makeSet([makePrompt({ status })])]),
    );
    renderWithProviders(<RunsScreen />, {
      projectSelection: {
        projects: [project],
        activeProject: project,
        activeProjectId: project.id,
        status: 'ready',
      },
    });

    const heading = await screen.findByRole('heading', { name: 'No runs yet' });
    const empty = within(heading.closest<HTMLElement>('[data-state-block="empty"]')!);
    await waitFor(() =>
      expect(empty.getByRole(next.role, { name: next.name })).not.toHaveAttribute('aria-disabled'),
    );
    expect(screen.queryAllByRole('button', { name: 'Launch run' })).toHaveLength(
      next.name === 'Launch run' ? 1 : 0,
    );
    if (schedules) await screen.findByRole('heading', { name: 'Scheduled audits' });
    else expect(screen.queryByRole('heading', { name: 'Scheduled audits' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Completed/ })).toBeNull();
  },
);
