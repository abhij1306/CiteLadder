import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { promptsApi } from '@/lib/api/prompts';
import type { ActiveRun } from '@/lib/visibility/dashboard';
import { makeProject } from '@/test/fixtures/project';
import { makePrompt, makeSet, makeSetList } from '@/test/fixtures/prompts';
import { renderWithProviders as render, selectionAs } from '@/test/render';

import { ActiveRunBanner } from './active-run-banner';
import { VisibilityEmptyState } from './empty-state';

const run: ActiveRun = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'running',
  createdAt: '2026-08-01T00:00:00Z',
};

afterEach(() => vi.restoreAllMocks());

describe('VisibilityEmptyState', () => {
  it.each([
    ['Add prompts while no prompt is active', 'archived', 'link', 'Add prompts'],
    ['Launch run once a prompt is active', 'active', 'button', 'Launch run'],
  ] as const)('carries %s', async (_label, status, role, name) => {
    vi.spyOn(promptsApi, 'listPromptSets').mockResolvedValue(
      makeSetList([makeSet([makePrompt({ status })])]),
    );
    const project = makeProject();
    render(<VisibilityEmptyState activeRun={null} />, {
      projectSelection: {
        projects: [project],
        activeProject: project,
        activeProjectId: project.id,
        status: 'ready',
      },
    });

    expect(screen.getByRole('heading', { name: 'No visibility data yet' })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole(role, { name })).not.toHaveAttribute('aria-disabled'),
    );
    expect(screen.queryByRole('link', { name: /Watch live progress/ })).not.toBeInTheDocument();
  });

  it('does not offer a viewer a step their role may not take', () => {
    render(<VisibilityEmptyState activeRun={null} />, {
      projectSelection: selectionAs('viewer'),
    });

    expect(screen.getByRole('heading', { name: 'No visibility data yet' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Launch run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add prompts' })).not.toBeInTheDocument();
  });

  it('links to the running run instead of inviting a duplicate', () => {
    render(<VisibilityEmptyState activeRun={run} />);

    expect(screen.queryByRole('button', { name: /Launch/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch live progress' })).toHaveAttribute(
      'href',
      `/runs/${run.id}`,
    );
    expect(screen.getByText('Running')).toBeVisible();
  });
});

describe('ActiveRunBanner', () => {
  it('names the run’s current status', () => {
    render(<ActiveRunBanner run={run} />);

    expect(screen.getByText(/A run is in progress \(Running\)/)).toBeVisible();
  });

  it('links to that exact run rather than the runs list', () => {
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
