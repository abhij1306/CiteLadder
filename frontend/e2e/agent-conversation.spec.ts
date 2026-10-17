import { expect, test } from '@playwright/test';

import type { AgentChatDetail } from '../lib/api/agent';
import { detail, revision, REV1 } from '../test/agent-chat-fixture';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const CHAT = '22222222-2222-4222-8222-222222222222';
const RUN = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-09-30T10:00:00Z';
const SKILLS = [
  {
    id: 'growth_plan',
    label: 'Growth plan',
    group: 'strategy',
    output_kind: 'plan',
    description: 'Prioritize the next work.',
  },
];

function chatDetail(): AgentChatDetail {
  return {
    chat: {
      id: CHAT,
      project_id: FIXTURE_PROJECT.id,
      action_id: null,
      target_label: null,
      title: 'Discuss buyer needs',
      turn_count: 12,
      output_kind: null,
      output_phase: null,
      last_activity_at: NOW,
      created_at: NOW,
      running: false,
    },
    pinned_skill_id: 'growth_plan',
    context: {
      refs: { site_facts_reference: { crawl_id: RUN } },
      instructions: { revision: 2 },
      limitations: [],
      prompt: {
        included_sections: ['site_facts'],
        omissions: ['oldest_history_messages'],
        serialized_chars: 5000,
        max_chars: 90000,
      },
    },
    output: null,
    messages: Array.from({ length: 24 }, (_, index) => ({
      id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
      sequence: index + 1,
      role: index % 2 ? 'agent' : 'user',
      content:
        index % 2
          ? `Answer ${index}.\n\n${'Explain the buyer decision using the available project evidence. '.repeat(12)}`
          : `Question ${index}`,
      skill_id: 'growth_plan',
      skill_source: 'chat',
      evidence_refs: [],
      steps: [],
      mentions: [],
      created_at: NOW,
    })),
    latest_run: {
      id: RUN,
      status: 'running',
      mode: 'turn',
      skill_id: 'growth_plan',
      skill_source: 'chat',
      steps_used: 1,
      error_code: '',
      error_detail: '',
      // A turn that has just started, so the page reads it at its quickest cadence.
      created_at: new Date().toISOString(),
      completed_at: null,
      progress: [],
    },
  };
}

for (const width of [1280, 390]) {
  test(`new chat keeps one composer and follow-ups stay after the result at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const current = detail(revision(REV1, 1, 'agent', 'Use clearer pricing and buyer examples.'));
    current.chat.project_id = FIXTURE_PROJECT.id;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading = false;
    await stubAuthedShell(page, [
      ['**/api/v1/agent/skills', { skills: SKILLS }],
      [
        `**/api/v1/projects/${FIXTURE_PROJECT.id}/actions*`,
        { items: [], next_cursor: null, status_counts: {} },
      ],
      [`**/api/v1/projects/${FIXTURE_PROJECT.id}/agent/chats?*`, { items: [], next_cursor: null }],
    ]);
    await page.route(`**/api/v1/agent/chats/${CHAT}`, async (route) => {
      reading = true;
      await ready;
      await route.fulfill({ json: current });
    });
    await page.route(`**/api/v1/projects/${FIXTURE_PROJECT.id}/agent/chats`, (route) =>
      route.fulfill({ status: 202, json: { chat_id: CHAT, run: current.latest_run } }),
    );
    await page.route(`**/api/v1/agent/chats/${CHAT}/messages`, (route) => {
      current.messages.push({
        ...current.messages[0]!,
        id: '77777777-7777-4777-8777-777777777773',
        sequence: 3,
        content: 'Explain the first recommendation.',
      });
      current.latest_run.status = 'queued';
      return route.fulfill({ status: 202, json: { chat_id: CHAT, run: current.latest_run } });
    });
    await page.goto(fixtureProjectPath('/agent'));
    const composer = page.getByLabel('Message the agent');
    await composer.fill('Improve our pricing page snippet.');
    const before = await composer.boundingBox();
    await composer.press('Enter');
    await expect.poll(() => reading).toBe(true);
    await expect(page.getByRole('combobox')).toHaveCount(1);
    await expect(composer).toHaveValue('Improve our pricing page snippet.');
    const pending = await composer.boundingBox();
    expect(Math.abs(pending!.y - before!.y)).toBeLessThanOrEqual(1);
    release();
    const reply = page.getByLabel('Reply to the agent');
    await expect(reply).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(1);
    await reply.fill('Explain the first recommendation.');
    await reply.press('Enter');
    const followUp = page.getByText('Explain the first recommendation.', { exact: true });
    await expect(followUp).toBeVisible();
    const result = page.getByRole('region', { name: 'Pricing page edits' });
    expect(
      await result.evaluate((element) => {
        const messages = element.closest('ol')!;
        const followUp = messages.lastElementChild!;
        return Boolean(
          element.compareDocumentPosition(followUp) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`ordered-chat-${width}.png`) });
  });
  for (const surface of ['page', 'panel']) {
    test(`${surface} conversation preserves reading and recovers a send at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const current = chatDetail();
      const sends: { key: string | undefined; body: unknown }[] = [];
      let reads = 0;
      await stubAuthedShell(page, [
        ['**/api/v1/agent/skills', { skills: SKILLS }],
        [
          `**/api/v1/projects/${FIXTURE_PROJECT.id}/actions*`,
          { items: [], next_cursor: null, status_counts: {} },
        ],
        [
          `**/api/v1/projects/${FIXTURE_PROJECT.id}/agent/chats?*`,
          { items: [], next_cursor: null },
        ],
      ]);
      await page.route(`**/api/v1/agent/chats/${CHAT}`, (route) => {
        reads++;
        return route.fulfill({ json: current });
      });
      await page.route(`**/api/v1/projects/${FIXTURE_PROJECT.id}/agent/chats`, (route) =>
        route.fulfill({ status: 202, json: { chat_id: CHAT, run: current.latest_run } }),
      );
      await page.route(`**/api/v1/agent/chats/${CHAT}/runs/${RUN}/cancel`, (route) => {
        current.latest_run!.status = 'cancelled';
        // The server answers a stopped turn with a saved reply.
        current.messages.push({
          ...current.messages.at(-1)!,
          id: '77777777-7777-4777-8777-999999999997',
          sequence: 27,
          content: 'Stopped. Nothing from this turn was saved.',
        });
        return route.fulfill({ json: current.latest_run });
      });
      await page.route(`**/api/v1/agent/chats/${CHAT}/messages`, (route) => {
        sends.push({
          key: route.request().headers()['idempotency-key'],
          body: route.request().postDataJSON(),
        });
        if (sends.length === 1)
          return route.fulfill({ status: 503, json: { error: { message: 'Temporary failure' } } });
        current.latest_run!.status = 'succeeded';
        return route.fulfill({ status: 202, json: { chat_id: CHAT, run: current.latest_run } });
      });

      await page.goto(
        fixtureProjectPath(surface === 'page' ? `/agent/chats/${CHAT}` : '/projects'),
      );
      if (surface === 'panel') {
        await page.getByRole('button', { name: 'Open agent' }).click();
        await page.getByLabel('Message the agent').fill('Discuss buyer needs');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
      }
      const reply = page.getByLabel('Reply to the agent');
      await expect(reply).toBeVisible();
      await page.getByText('Context used', { exact: true }).click();
      await expect(page.getByText('Selected crawl robots policy', { exact: true })).toBeVisible();
      // Context is described in plain words; record identities never reach the reader.
      await expect(page.getByText(RUN)).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`context-${surface}-${width}.png`) });
      await expect(
        page.getByRole('button', { name: 'Skill: Continue with Growth plan' }),
      ).toBeVisible();
      await reply.fill('Draft kept while working');
      // While the turn runs, Stop takes Send's place and drafting continues.
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
      if (surface === 'panel')
        await page
          .getByRole('region', { name: 'Agent conversation' })
          .evaluate((element) => element.scrollTo(0, 0));
      else await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeAttached();
      const priorReads = reads;
      current.messages.push({
        ...current.messages.at(-1)!,
        id: '77777777-7777-4777-8777-999999999999',
        sequence: 25,
        content: 'Latest persisted answer.',
      });
      await expect.poll(() => reads).toBeGreaterThan(priorReads);
      await expect(page.getByText('Latest persisted answer.')).toBeAttached();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const position =
        surface === 'panel'
          ? await page
              .getByRole('region', { name: 'Agent conversation' })
              .evaluate((element) => element.scrollTop)
          : await page.evaluate(() => window.scrollY);
      expect(position).toBe(0);
      await page.getByRole('button', { name: 'Jump to latest' }).click();
      await expect(page.getByText('Latest persisted answer.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Jump to latest' })).not.toBeAttached();
      current.messages.push({
        ...current.messages.at(-1)!,
        id: '77777777-7777-4777-8777-999999999998',
        sequence: 26,
        content: 'Next persisted answer.\n\n' + 'Additional buyer evidence. '.repeat(40),
      });
      await expect(page.getByText(/Next persisted answer/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Jump to latest' })).not.toBeAttached();
      const remaining =
        surface === 'panel'
          ? await page
              .getByRole('region', { name: 'Agent conversation' })
              .evaluate(
                (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
              )
          : await page.evaluate(
              () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight,
            );
      expect(remaining).toBeLessThanOrEqual(surface === 'panel' ? 1 : 96);
      await expect(reply).toHaveValue('Draft kept while working');
      const stop = page.getByRole('button', { name: 'Stop', exact: true });
      await stop.focus();
      await stop.press('Enter');
      await expect(page.getByText('Stopped. Nothing from this turn was saved.')).toBeVisible();

      await reply.fill('');
      await reply.press('/');
      await expect(
        page.getByRole('menuitemradio', { name: 'Growth plan', exact: true }),
      ).toBeVisible();
      await reply.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      await expect(reply).toHaveValue('/');
      await page.getByRole('menuitemradio', { name: 'Growth plan', exact: true }).click();
      await expect(reply).toBeFocused();
      await page.getByRole('button', { name: 'Skill: Growth plan', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Automatic', exact: true }).click();
      await reply.fill('Explain this');
      await reply.press('Shift+Enter');
      await reply.press('Enter');
      await expect(page.getByRole('button', { name: 'Retry send' })).toBeVisible();
      await expect(reply).toHaveValue('Explain this\n');
      await page.getByRole('button', { name: 'Retry send' }).click();
      await expect.poll(() => sends.length).toBe(2);
      expect(sends[0]!.key).toBeTruthy();
      expect(sends[1]).toEqual(sends[0]);
      expect(sends[0]!.body).toMatchObject({ skill_id: null });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${surface}-${width}.png`) });
    });
  }
}
