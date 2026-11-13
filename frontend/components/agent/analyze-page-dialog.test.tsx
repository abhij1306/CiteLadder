import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useParams } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { makePrompt, makeSet, makeSetList } from '@/test/fixtures/prompts';
import { makeProject } from '@/test/fixtures/project';
import { mswServer } from '@/test/msw-server';
import { renderWithProviders } from '@/test/render';

import { AnalyzePageButton } from './analyze-page-dialog';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CRAWL = '99999999-9999-4999-8999-999999999999';
const GUIDE = '44444444-4444-4444-8444-444444444444';
const CHAT = '55555555-5555-4555-8555-555555555555';
const ACTION = '66666666-6666-4666-8666-666666666666';
const CRM = '77777777-7777-4777-8777-777777777777';
const HIRING = '78787878-7878-4878-8878-787878787878';

const topic = (id: string, name: string, activeCount: number) => ({
  id,
  project_id: PROJECT,
  parent_id: null,
  name,
  description: '',
  origin: 'manual',
  active_count: activeCount,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const best = makePrompt({
  id: '81818181-8181-4181-8181-818181818181',
  text: 'Best CRM for small teams?',
  topic_id: CRM,
});
const cheapest = makePrompt({
  id: '82828282-8282-4282-8282-828282828282',
  text: 'Cheapest CRM?',
  topic_id: CRM,
});

/** The project's crawl pages, topics and prompts as the API answers; posts are recorded. */
function serve(pages: { crawl_id: string | null; items: unknown[] }, posted: unknown[] = []) {
  mswServer.use(
    http.get(`/api/v1/projects/${PROJECT}/actions/analyze/pages`, () =>
      HttpResponse.json({ ...pages, truncated: false }),
    ),
    http.get(`/api/v1/projects/${PROJECT}/topics`, () =>
      HttpResponse.json([topic(CRM, 'CRM software', 2), topic(HIRING, 'Hiring', 0)]),
    ),
    http.get('/api/v1/prompt-sets', () =>
      HttpResponse.json(makeSetList([makeSet([best, cheapest])])),
    ),
    http.post(`/api/v1/projects/${PROJECT}/actions/analyze`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json({ action_id: ACTION, chat_id: CHAT, run: null }, { status: 202 });
    }),
  );
}

const guide = {
  site_url_id: GUIDE,
  url: 'https://acme.test/guides/crm-pricing',
  title: 'CRM pricing guide',
  page_kind: 'guide',
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

function ChatRoute() {
  return <p>Chat {useParams().chatId}</p>;
}

async function openDialog() {
  const user = userEvent.setup();
  renderWithProviders(
    <Routes>
      <Route path="/agent/actions" element={<AnalyzePageButton />} />
      <Route path="/agent/chats/:chatId" element={<ChatRoute />} />
    </Routes>,
    {
      initialEntries: ['/agent/actions'],
      projectSelection: {
        activeProjectId: PROJECT,
        activeProject: makeProject({ id: PROJECT }),
        status: 'ready',
      },
    },
  );
  await user.click(screen.getByRole('button', { name: 'Analyze a page' }));
  return { user, dialog: await screen.findByRole('dialog', { name: 'Analyze a page' }) };
}

describe('Analyze a page', () => {
  it('says a crawl comes first when the project has none', async () => {
    serve({ crawl_id: null, items: [] });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText('No crawl yet')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Generate action' })).toBeDisabled();
  });

  it('offers the crawl content pages by title and path, and topics that have prompts', async () => {
    serve({ crawl_id: CRAWL, items: [guide] });
    const { user, dialog } = await openDialog();
    await user.click(await within(dialog).findByRole('combobox', { name: 'Page' }));
    const pages = await screen.findByRole('listbox', { name: 'Page' });
    expect(
      within(pages)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['CRM pricing guide/guides/crm-pricing']);

    await user.click(within(dialog).getByRole('combobox', { name: 'Topic' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      expect.stringContaining('CRM software'),
    ]);
  });

  it('blocks Generate until a page, a topic and a prompt are chosen, then opens the chat', async () => {
    const posted: unknown[] = [];
    serve({ crawl_id: CRAWL, items: [guide] }, posted);
    const { user, dialog } = await openDialog();
    const generate = within(dialog).getByRole('button', { name: 'Generate action' });

    await user.click(await within(dialog).findByRole('combobox', { name: 'Page' }));
    await user.click(await screen.findByRole('option', { name: /CRM pricing guide/ }));
    expect(generate).toBeDisabled();

    await user.click(within(dialog).getByRole('combobox', { name: 'Topic' }));
    await user.click(await screen.findByRole('option', { name: /CRM software/ }));
    // Every prompt of the topic starts selected.
    expect(within(dialog).getByText('2 of 2')).toBeVisible();
    expect(generate).toBeEnabled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Best CRM for small teams?' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Cheapest CRM?' }));
    expect(generate).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Cheapest CRM?' }));

    await user.click(generate);
    expect(await screen.findByText(`Chat ${CHAT}`)).toBeVisible();
    expect(posted).toEqual([{ site_url_id: GUIDE, topic_id: CRM, prompt_ids: [cheapest.id] }]);
  });
});
