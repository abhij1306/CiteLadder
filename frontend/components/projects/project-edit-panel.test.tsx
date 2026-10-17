import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { makeProject } from '@/test/fixtures/project';
import { renderWithProviders } from '@/test/render';

import { ProjectEditPanel } from './project-edit-panel';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  mswServer.use(
    http.get('/api/v1/brand-discovery-catalog', () =>
      HttpResponse.json({
        maximum_competitors: 5,
        industries: ['General'],
        subindustries: { General: [] },
      }),
    ),
  );
});
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

// The competitor carries its id, so the fixture satisfies Project outright; the
// previous literal needed an `as unknown as Project` cast to hide its absence.
const project = makeProject({
  id: PROJECT_ID,
  workspace_id: '22222222-2222-4222-8222-222222222222',
  brand: { aliases: ['Acme Inc'] },
  owned_domains: ['acme.com'],
  competitors: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Globex',
      aliases: ['Globex Corp'],
      domains: ['globex.com'],
    },
  ],
});

describe('ProjectEditPanel', () => {
  it('sends the edited fields and keeps the aliases of a renamed competitor', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    mswServer.use(
      http.patch(`/api/v1/projects/${PROJECT_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...project, ...body });
      }),
    );

    renderWithProviders(<ProjectEditPanel project={project} open onOpenChange={vi.fn()} />);

    const aliases = screen.getByLabelText('Brand aliases');
    await user.clear(aliases);
    await user.type(aliases, 'Acme Inc, Acme Co');
    const competitorName = screen.getByLabelText('Competitor 1 name');
    await user.clear(competitorName);
    await user.type(competitorName, 'Globex Group');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.brand).toEqual({ aliases: ['Acme Inc', 'Acme Co'] });
    // The panel does not edit per-competitor aliases, so a rename must keep
    // the ones the project already had.
    expect(body?.competitors).toEqual([
      { name: 'Globex Group', aliases: ['Globex Corp'], domains: ['globex.com'] },
    ]);
  });

  it('drops blank entries from the comma-separated lists', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    mswServer.use(
      http.patch(`/api/v1/projects/${PROJECT_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...project, ...body });
      }),
    );

    renderWithProviders(<ProjectEditPanel project={project} open onOpenChange={vi.fn()} />);

    const owned = screen.getByLabelText('Owned');
    await user.clear(owned);
    await user.type(owned, 'acme.com, , shop.acme.com,');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.owned_domains).toEqual(['acme.com', 'shop.acme.com']);
  });

  it('shows a common-word brand its mention rule and saves only the rule that changed', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    mswServer.use(
      http.patch(`/api/v1/projects/${PROJECT_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(project);
      }),
    );
    const target = {
      ...project,
      brand_name: 'Target',
      brand: {
        aliases: [],
        matching: {
          mode: 'context_required' as const,
          context_terms: ['Home goods'],
          exclusion_phrases: [],
          common_word: true,
        },
      },
    };

    renderWithProviders(<ProjectEditPanel project={target} open onOpenChange={vi.fn()} />);

    const rule = screen.getByRole('group', { name: 'Mention rule for Target' });
    expect(within(rule).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await user.type(within(rule).getByLabelText('Never counts inside'), 'target audience');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.entity_matching).toEqual([
      {
        name: 'Target',
        mode: 'context_required',
        context_terms: ['Home goods'],
        exclusion_phrases: ['target audience'],
      },
    ]);
  });

  it('does not allow a sixth competitor', async () => {
    const fiveCompetitors = Array.from({ length: 5 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Competitor ${index + 1}`,
      aliases: [],
      domains: [],
    }));

    renderWithProviders(
      <ProjectEditPanel
        project={{ ...project, competitors: fiveCompetitors }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText('5 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add competitor' })).toBeDisabled();
    expect(screen.getAllByLabelText(/Competitor \d+ name/)).toHaveLength(5);
  });
});
