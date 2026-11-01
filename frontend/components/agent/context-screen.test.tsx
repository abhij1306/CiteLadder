import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { queryKeys } from '@/lib/api/query-keys';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders, testProjectSelection } from '@/test/render';
import { ProjectSelectionProvider } from '@/lib/project/project-scope';

import { ContextScreen } from './context-screen';

const project = makeProject();
const endpoint = `/api/v1/projects/${project.id}/agent/instructions`;
const saved = (text: string) => ({ text, revision: 1, created_at: '2026-09-26T10:00:00Z' });

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function ContextScope({ activeProject }: { activeProject: ReturnType<typeof makeProject> }) {
  return (
    <ProjectSelectionProvider
      value={testProjectSelection({
        activeProject,
        activeProjectId: activeProject.id,
        status: 'ready',
      })}
    >
      <ContextScreen />
    </ProjectSelectionProvider>
  );
}

function renderContext() {
  mswServer.use(
    http.get(endpoint, () => HttpResponse.json(saved('Original'))),
    http.get('/api/v1/projects/:id/brand-profile', () => HttpResponse.json(null)),
    http.get('/api/v1/projects/:id/competitor-suggestions', () => HttpResponse.json([])),
  );
  return renderWithProviders(<ContextScope activeProject={project} />);
}

/** Saved agent instructions and an empty company profile, as a new project has. */
function emptyCompanyFacts() {
  const none = {
    description: null,
    positioning: null,
    products_services: null,
    target_audience: null,
  };
  mswServer.use(
    http.get(endpoint, () => HttpResponse.json(saved('Original'))),
    http.get('/api/v1/projects/:id/brand-profile', () =>
      HttpResponse.json({
        id: '22222222-2222-4222-8222-222222222222',
        workspace_id: '33333333-3333-4333-8333-333333333333',
        project_id: project.id,
        brand_id: '44444444-4444-4444-8444-444444444444',
        description: '',
        positioning: '',
        products_services: [],
        target_audience: '',
        business_context: {},
        sources: none,
        source_artifact_ids: none,
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      }),
    ),
    http.get('/api/v1/projects/:id/competitor-suggestions', () => HttpResponse.json([])),
  );
}

describe('Context layout', () => {
  it('shows the Brand facts tab with its error when the pilot gate cannot be read', async () => {
    const user = userEvent.setup({ delay: null });
    emptyCompanyFacts();
    mswServer.use(
      http.get('/api/v1/projects/:id/brand-facts', () =>
        HttpResponse.json(
          { error: { message: 'The fact-checking pilot is unavailable.' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<ContextScope activeProject={project} />);
    await user.click(await screen.findByRole('tab', { name: 'Brand facts' }));
    expect(await screen.findByText('The fact-checking pilot is unavailable.')).toBeVisible();
  });

  it('leads with Company facts and keeps pilot Brand facts as one of its tabs', async () => {
    const user = userEvent.setup({ delay: null });
    emptyCompanyFacts();
    mswServer.use(
      http.get('/api/v1/projects/:id/brand-facts', () =>
        HttpResponse.json({
          enabled: true,
          facts: [
            {
              id: '55555555-5555-4555-8555-555555555556',
              topic: 'pricing',
              statement: 'Pro costs $59 per month.',
              source_url: null,
              status: 'confirmed',
              revision: 1,
              updated_at: '2026-11-01T00:00:00Z',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<ContextScope activeProject={project} />);
    const facts = await screen.findByRole('tab', { name: 'Brand facts' });
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Company facts', 'Agent instructions']);
    // Brand facts show only on their own tab, never under every tab.
    expect(screen.queryByText('Pro costs $59 per month.')).not.toBeInTheDocument();
    await user.click(facts);
    expect(screen.getByText('Pro costs $59 per month.')).toBeVisible();
  });
});

describe('Agent instruction drafts', () => {
  it('resets a draft when the active project changes', async () => {
    const nextProject = makeProject({ id: '11111111-1111-4111-8111-111111111112' });
    const { rerender } = renderContext();
    mswServer.use(
      http.get(`/api/v1/projects/${nextProject.id}/agent/instructions`, () =>
        HttpResponse.json(saved('Second project')),
      ),
    );
    const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
    fireEvent.change(field, { target: { value: 'Unsaved first-project draft' } });
    rerender(<ContextScope activeProject={nextProject} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Agent instructions' })).toHaveValue(
        'Second project',
      ),
    );
  });
  it('follows refreshed instructions until edited, then preserves the local draft', async () => {
    const { queryClient } = renderContext();
    const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
    act(() =>
      queryClient.setQueryData(queryKeys.agent.instructions(project.id), saved('Refreshed')),
    );
    await waitFor(() => expect(field).toHaveValue('Refreshed'));
    fireEvent.change(field, { target: { value: 'Local draft' } });
    act(() =>
      queryClient.setQueryData(queryKeys.agent.instructions(project.id), saved('Remote edit')),
    );
    await waitFor(() => expect(field).toHaveValue('Local draft'));
    fireEvent.change(field, { target: { value: 'Original' } });
    expect(field).toHaveValue('Original');
    expect(screen.getByRole('button', { name: 'Save instructions' })).toBeEnabled();
  });

  it.each(['Later typing', 'Original'])(
    'preserves %s entered while a save is pending',
    async (later) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { queryClient } = renderContext();
      mswServer.use(
        http.put(endpoint, async () => {
          await pending;
          return HttpResponse.json(saved('Submitted'));
        }),
      );
      const field = await screen.findByRole('textbox', { name: 'Agent instructions' });
      fireEvent.change(field, { target: { value: 'Submitted' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save instructions' })).toBeDisabled(),
      );
      fireEvent.change(field, { target: { value: later } });
      release();
      await waitFor(() =>
        expect(queryClient.getQueryData(queryKeys.agent.instructions(project.id))).toEqual(
          saved('Submitted'),
        ),
      );
      expect(field).toHaveValue(later);
      expect(screen.getByRole('button', { name: 'Save instructions' })).toBeEnabled();
    },
  );
});
