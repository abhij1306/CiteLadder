import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { SkillsScreen } from './skills-screen';

const PROJECT = '11111111-1111-4111-8111-111111111111';

const CATALOG = {
  skills: [
    {
      id: 'social_post',
      label: 'Social post',
      group: 'content',
      output_kind: 'linkedin_post',
      description: 'A short professional post.',
    },
    {
      id: 'mystery',
      label: 'Mystery skill',
      group: 'content',
      output_kind: 'unlisted',
      description: 'Produces something the catalog does not name.',
    },
  ],
  workflow_groups: [],
  workflows: [],
  output_kinds: [{ kind: 'linkedin_post', label: 'LinkedIn post', refinements: [], next: [] }],
  limits: { mentions_max: 5 },
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Skills', () => {
  it('names what each skill produces in sentence case, keeping the output name as written', async () => {
    mswServer.use(http.get('/api/v1/agent/skills', () => HttpResponse.json(CATALOG)));
    renderWithProviders(<SkillsScreen />, {
      initialEntries: ['/agent/skills'],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    });

    const post = (await screen.findByRole('heading', { name: 'Social post' })).closest('li')!;
    expect(within(post).getByText('Output: LinkedIn post')).toBeVisible();
    // An output the catalog does not name gets no badge, not a placeholder.
    const mystery = screen.getByRole('heading', { name: 'Mystery skill' }).closest('li')!;
    expect(within(mystery).queryByText(/^Output/)).not.toBeInTheDocument();
  });
});
