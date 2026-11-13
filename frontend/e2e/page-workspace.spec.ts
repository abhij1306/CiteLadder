import { expect, test, type Page } from '@playwright/test';

import { CHAT, OUTPUT, REV2, skills } from '../test/agent-chat-fixture';
import { actionsPage } from '../test/fixtures/actions';
import { pageChat, spanSuggestion, suggestionsPage } from '../test/page-suggestions-fixture';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const PROJECT = FIXTURE_PROJECT.id;
const ACTION = '66666666-6666-4666-8666-666666666666';
const READY = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEEDS = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOW = '2026-11-10T10:00:00Z';
const MESSAGE = 'Improve the pricing page so AI answers can cite it.';
const BODY = [
  '# Pricing',
  '',
  'Our plans start at ten dollars a month for one seat. Teams pay more, depending on how many people need access.',
  '',
  '## Support',
  '',
  'Email us any time and we answer within one working day.',
].join('\n');
const APPLIED = BODY.replace('ten dollars', '$10');
const SUGGESTIONS = `**/api/v1/agent/chats/${CHAT}/outputs/${OUTPUT}/suggestions`;

const action = {
  id: ACTION,
  project_id: PROJECT,
  target_kind: 'page',
  target_label: 'https://acme.test/pricing',
  target_url: 'https://acme.test/pricing',
  target_prompt_id: null,
  origin: 'evidence',
  status: 'open',
  priority_score: 80,
  priority_band: 'high',
  families: ['site_health'],
  approach: 'improve_page',
  group: 'own_pages',
  skill_id: 'content_refresh',
  member_count: 0,
  declarable_member_count: 0,
  handoff: { context: 'action', message: MESSAGE },
  evidence_cleared_at: null,
  created_at: NOW,
  updated_at: NOW,
};

const catalog = {
  ...skills,
  workflows: [
    ...skills.workflows,
    {
      id: 'optimize_page',
      group: 'improve',
      label: 'Optimize a page',
      description: 'Work on one of your pages.',
      skill_id: 'content_refresh',
      format_id: null,
      prompt: 'Optimize this page.',
      inputs: [],
    },
  ],
};

const ready = (body: string, overrides = {}) =>
  spanSuggestion(READY, body, 'ten dollars', { replacement: '$10', ...overrides });
const needsInput = (body: string) =>
  spanSuggestion(NEEDS, body, 'Teams pay more', {
    readiness: 'needs_input',
    replacement: null,
    needs_input: 'What does the Teams plan cost?',
  });

/** Stubs the Action, New chat, the page chat and its suggestions; Apply moves the page to revision 2. */
async function stubWorkspace(page: Page) {
  const state = {
    created: [] as unknown[],
    chat: pageChat(BODY, { projectId: PROJECT, actionId: ACTION }),
    suggestions: suggestionsPage([ready(BODY), needsInput(BODY)]),
  };
  await stubAuthedShell(page, [
    ['**/api/v1/agent/skills', catalog],
    [`**/api/v1/projects/${PROJECT}/actions*`, actionsPage()],
    [`**/api/v1/projects/${PROJECT}/agent/chats?*`, { items: [], next_cursor: null }],
  ]);
  await page.route(`**/api/v1/actions/${ACTION}`, (route) =>
    route.fulfill({
      json: {
        ...action,
        diagnosis: { approach: action.approach, donts: [], measure_with: ['next_crawl'] },
        members: [],
        member_measurement: {},
        declarable_since: '2026-01-01T00:00:00Z',
        declaration: null,
        editable_page: true,
      },
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT}/agent/chats`, async (route) => {
    state.created.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { chat_id: CHAT, run: null } });
  });
  await page.route(`**/api/v1/agent/chats/${CHAT}`, (route) => route.fulfill({ json: state.chat }));
  await page.route(SUGGESTIONS, (route) => route.fulfill({ json: state.suggestions }));
  await page.route(`${SUGGESTIONS}/${READY}/apply`, (route) => {
    state.chat = pageChat(APPLIED, {
      revisionId: REV2,
      number: 2,
      projectId: PROJECT,
      actionId: ACTION,
    });
    const start = APPLIED.indexOf('$10');
    // Anchored where it was made (revision 1); its replacement is where it is now.
    const applied = ready(BODY, { status: 'applied', position: { start, end: start + 3 } });
    state.suggestions = suggestionsPage([applied, needsInput(APPLIED)], REV2);
    return route.fulfill({
      json: { outcome: 'applied', reason: null, suggestion: applied, revision: null },
    });
  });
  return state;
}

const highlight = (page: Page, id: string) => page.locator(`mark[data-suggestion-id="${id}"]`);

/** Nothing on the page scrolls sideways at this width. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [1280, 390]) {
  test(`an Action opens its page in the workspace, and suggestions apply and fill the chat at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await stubWorkspace(page);
    const narrow = width < 1024;

    await page.goto(fixtureProjectPath(`/agent/actions/${ACTION}`));
    await page.getByRole('link', { name: 'Work with the agent' }).first().click();
    const composer = page.getByLabel('Message the agent');
    await expect(composer).toHaveValue(MESSAGE);
    await composer.press('Enter');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Actions › acme.test/pricing' }),
    ).toBeVisible();
    expect(state.created).toEqual([
      expect.objectContaining({
        message: MESSAGE,
        action_id: ACTION,
        workflow_id: 'optimize_page',
      }),
    ]);
    const editor = page.getByRole('textbox', { name: 'Page content (Markdown)' });
    await expect(editor).toContainText('Our plans start at ten dollars');
    await expect(highlight(page, READY)).toHaveText('ten dollars');
    await expectNoSidewaysScroll(page);

    if (narrow) {
      await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
      await page.getByRole('tab', { name: /Suggestions/ }).click();
    } else {
      // The page and the rail sit side by side, the page the wider of the two.
      const pageBox = await page.getByRole('region', { name: 'Page' }).boundingBox();
      const railBox = await page.getByRole('tab', { name: 'Outline' }).boundingBox();
      expect(railBox!.x).toBeGreaterThan(pageBox!.x + pageBox!.width - 1);
      expect(pageBox!.width).toBeGreaterThan(width * 0.45);
    }

    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    if (narrow) await page.getByRole('tab', { name: 'Page' }).click();
    await expect(editor).toContainText('Our plans start at $10');
    await expect(highlight(page, READY)).toHaveCount(0);
    await expect(highlight(page, NEEDS)).toHaveText('Teams pay more');

    if (narrow) await page.getByRole('tab', { name: /Suggestions/ }).click();
    await page.getByRole('button', { name: 'Add to context' }).click();
    const reply = page.getByLabel('Reply to the agent');
    await expect(reply).toBeVisible();
    await expect(reply).toHaveValue(
      '> What does the Teams plan cost?\n> On: “Teams pay more”\n\nHere is the fact you asked for:',
    );
    await expectNoSidewaysScroll(page);
  });
}
