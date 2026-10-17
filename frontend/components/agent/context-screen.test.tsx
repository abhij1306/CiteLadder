import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
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
