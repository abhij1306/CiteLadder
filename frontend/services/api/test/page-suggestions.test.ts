/**
 * Suggestions on a page document against real PostgreSQL (content
 * optimization phase 2, PR 2). A recorded site is fetched into the chat's page
 * document, a scripted model stages suggestions with `suggest_edits`, and the
 * person applies, dismisses and reverts them. Nothing reaches the network or a
 * model provider.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { agentSuggestionsPageSchema } from '@citeladder/contracts/agent';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import type { Json, Scope } from '../src/agent/contracts.ts';
import { ModelCalls, type ModelRequest } from '../src/agent/model-calls.ts';
import { AgentOutputs } from '../src/agent/outputs.ts';
import { readChat } from '../src/agent/reads.ts';
import { AgentRuntime } from '../src/agent/runtime.ts';
import type { AdmittedModel } from '../src/agent/store.ts';
import { runAgentOnce } from '../src/agent/worker.ts';
import { createApp } from '../src/app.ts';
import { pageFetchTask } from '../src/page-documents/fetch-task.ts';
import { PAGE_FETCH_KIND } from '../src/page-documents/keys.ts';
import { listSuggestions } from '../src/page-documents/suggestion-views.ts';
import { modelAvailable, reply, scripted, toolUse, type Response } from './agent-support.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { recordedSite, SiteFixtures, storedFacts } from './site-health-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const db = testDatabase();
const config = testConfig();
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
const workspaces: string[] = [];
afterAll(async () => {
  vi.restoreAllMocks();
  for (const table of ['agent_model_attempts', 'analytics_tasks'] as const)
    if (workspaces.length)
      await db.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
  await fixtures.cleanup();
  await db.destroy();
});

const PAGE = 'https://example.test/crm-pricing';
// A title and no meta description: Site Health's page-local check finds the missing field.
const ARTICLE = `<!doctype html><html><head><title>CRM pricing compared</title></head><body><main>
<h1>CRM pricing</h1>
<p>Compare plans across five tools.</p>
<h2>Starter</h2>
<p>Starter costs $10 a month. It suits two users.</p>
<h2>Pro</h2>
<p>Pro costs $30 a month.</p>
</main></body></html>`;
const BODY = [
  '# CRM pricing',
  '',
  'Compare plans across five tools.',
  '',
  '## Starter',
  '',
  'Starter costs $10 a month. It suits two users.',
  '',
  '## Pro',
  '',
  'Pro costs $30 a month.',
].join('\n');

const agent = await createAgentBindings(db, {});
agent.store.dependencies.admission = () =>
  Promise.resolve({
    requested_model: 'test-model',
  } satisfies AdmittedModel);
vi.spyOn(bindingsOwner, 'agentBindings').mockResolvedValue(agent);
const outputs = new AgentOutputs(db);

/** A crawled project whose content page is PAGE, signed in as its owner. */
async function project() {
  const seed = await fixtures.crawl();
  workspaces.push(seed.workspaceId);
  const page = await fixtures.page(seed, '/crm-pricing', storedFacts({ title: 'CRM pricing' }));
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: 'comparison' })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.analysisId)
    .execute();
  const token = await sessionToken({ sub: seed.userId, ver: 0 });
  const headers = {
    cookie: `${TEST_SESSION_COOKIE}=${token}`,
    'X-Workspace-Id': seed.workspaceId,
    'Content-Type': 'application/json',
  };
  return { scope: seed satisfies Scope, headers };
}

/** An optimize-page chat whose page was fetched; its first turn is queued. */
async function pageChat() {
  const { scope, headers } = await project();
  const created = await agent.store.create(scope, {
    message: 'Improve this page so AI answers cite it.',
    key: randomUUID(),
    workflowId: 'optimize_page',
    refs: { target_url: PAGE },
  });
  await drainWorkspace(db, scope.workspaceId, {
    owner: `page-suggestions-${randomUUID()}`,
    executors: {
      [PAGE_FETCH_KIND]: pageFetchTask({
        fetcher: recordedSite({ '/crm-pricing': { body: ARTICLE } }),
        store: () => Promise.resolve(agent.store),
      }),
    },
  });
  const [document] = (await readChat(db, scope, created.chatId)).outputs;
  if (!document) throw new Error('Expected the page document');
  const chat = { scope, headers, chatId: created.chatId, outputId: document.id };
  return {
    ...chat,
    /** Runs the chat's queued turn with a scripted model; a later turn is queued first. */
    turn: async (responses: Response[], onCall?: (request: ModelRequest) => Promise<void>) => {
      const runtime = new AgentRuntime(db, {
        ...agent.runtime.deps,
        models: new ModelCalls(db, modelAvailable),
        modelFor: () => scripted(responses, onCall),
      });
      await runAgentOnce(agent.queue, runtime, `page-turn-${randomUUID()}`, [scope.workspaceId]);
    },
    ask: (message: string) =>
      agent.store.enqueue(scope, { chatId: chat.chatId, message, key: randomUUID() }),
    list: () => listSuggestions(db, scope, chat.chatId, chat.outputId),
    latest: async () => (await listSuggestions(db, scope, chat.chatId, chat.outputId)).revision_id,
    body: async () =>
      (await readChat(db, scope, chat.chatId)).outputs[0]?.latest_revision.body ?? null,
  };
}
type PageChat = Awaited<ReturnType<typeof pageChat>>;

const suggest = (suggestions: Record<string, Json>[]): Response => [
  toolUse('suggest_edits', { suggestions }),
];
const span = (oldString: string, newString: string, extra: Record<string, Json> = {}) => ({
  old_string: oldString,
  new_string: newString,
  rule_id: 'clarity.fluent_prose',
  rationale: 'Plainer wording.',
  ...extra,
});
/** A chat whose first turn staged these suggestions; returns their ids in the order given. */
async function suggested(items: Record<string, Json>[]) {
  const chat = await pageChat();
  await chat.turn([suggest(items), reply('Here are my suggestions.')]);
  const { items: listed } = await chat.list();
  const ids = items.map((item) => {
    const anchored = (anchor: (typeof listed)[number]['anchor']) => {
      if (anchor.kind === 'span') return anchor.quote.exact === item.old_string;
      if (anchor.kind === 'field') return anchor.field === item.field;
      return item.old_string === undefined && item.field === undefined;
    };
    const match = listed.find(
      (entry) =>
        entry.source === 'model' &&
        anchored(entry.anchor) &&
        entry.replacement === (item.new_string ?? null) &&
        entry.needs_input === (item.needs_input ?? null),
    );
    if (!match) throw new Error(`Suggestion was not stored: ${JSON.stringify(item)}`);
    return match.id;
  });
  return { chat, ids };
}
const target = (chat: PageChat, suggestionId: string, baseId: string) => ({
  chatId: chat.chatId,
  outputId: chat.outputId,
  suggestionId,
  baseId,
});
/** The Agent's suggestions; every chat on this page also has the Site Health meta description advice. */
const fromModel = async (chat: PageChat) => {
  const page = await chat.list();
  return page.items.filter((item) => item.source === 'model');
};
const statusOf = async (chat: PageChat, id: string) => {
  const page = await chat.list();
  return page.items.find((item) => item.id === id)?.status ?? 'stale';
};

describe('suggestions from the fetch and the Agent', () => {
  it('makes the missing meta description a Site Health suggestion the first turn sees and writes', async () => {
    const chat = await pageChat();
    expect(await chat.body()).toBe(BODY);
    const fetched = await chat.list();
    expect(
      fetched.items.map(({ source, rule_id, anchor, readiness, status }) => ({
        source,
        rule_id,
        anchor,
        readiness,
        status,
      })),
    ).toEqual([
      {
        source: 'site_health',
        rule_id: 'technical.meta_description_present',
        anchor: { kind: 'field', field: 'meta_description', expected: '' },
        readiness: 'advice',
        status: 'open',
      },
    ]);
    const finding = fetched.items[0]!.id;
    const seen: string[] = [];
    await chat.turn(
      [
        suggest([
          {
            field: 'meta_description',
            new_string: 'Compare CRM plans and monthly prices for small teams.',
            rule_id: 'technical.meta_description_present',
            rationale: 'The page has no meta description.',
          },
          span('Compare plans across five tools.', 'Compare the plans of five CRM tools.'),
          {
            old_string: 'It suits two users.',
            needs_input: 'How many users does Starter include?',
            rule_id: 'proof.specific_statistics',
            rationale: 'A number from you is more precise.',
          },
        ]),
        reply('I suggested three changes.'),
      ],
      async (request) => {
        if (!seen.length) seen.push(JSON.stringify(request.messages[0]));
      },
    );
    // The opening message lists the Site Health suggestion by id and status.
    expect(seen[0]).toContain(
      `${finding} [open] search_guidelines, technical.meta_description_present`,
    );
    // Its context offers the content rules the fetched page has evidence for:
    // coverage needs the page's prompts, which this chat has none of.
    expect(seen[0]).toContain('ai_answers.self_contained_passages [ai_answers, recommendation');
    expect(seen[0]).toContain('coverage.cited_angles (needs page_prompts)');
    const detail = await readChat(db, chat.scope, chat.chatId);
    expect(detail.messages.at(-1)?.content).toBe(
      'I suggested three changes.\n\n3 suggestions added to Document 1.',
    );
    const after = await chat.list();
    expect(
      after.items.map(({ source, anchor, position, readiness }) => ({
        source,
        kind: anchor.kind,
        position,
        readiness,
      })),
    ).toEqual([
      { source: 'model', kind: 'span', position: { start: 15, end: 47 }, readiness: 'ready' },
      {
        source: 'model',
        kind: 'span',
        position: { start: 88, end: 107 },
        readiness: 'needs_input',
      },
      { source: 'model', kind: 'field', position: null, readiness: 'ready' },
    ]);
    // Writing its text replaced the Site Health advice.
    expect(after.counts).toEqual({
      open: 3,
      applied: 0,
      dismissed: 0,
      stale: 1,
      needs_input: 1,
      by_category: [
        { category: 'clarity', open: 1 },
        { category: 'proof', open: 1 },
        { category: 'search_guidelines', open: 1 },
      ],
    });
  });

  it('stales an open suggestion the Agent’s own edit changed, and moves the rest', async () => {
    const { chat, ids } = await suggested([
      span('Compare plans across five tools.', 'Compare five CRM tools.'),
      span('Pro costs $30 a month.', 'Pro costs $30 per user a month.'),
    ]);
    await chat.ask('Fix the intro yourself.');
    await chat.turn([
      [
        toolUse('edit_document', {
          edits: [{ old_string: 'Compare plans', new_string: 'Weigh plans' }],
        }),
      ],
      reply('Done.'),
    ]);
    expect(
      (await fromModel(chat)).map(({ id, status, position }) => ({ id, status, position })),
    ).toEqual([{ id: ids[1], status: 'open', position: { start: 115, end: 137 } }]);
    expect((await chat.list()).counts.stale).toBe(1);
  });
});

describe('applying suggestions', () => {
  it('applies a ready span in a new revision and stales the alternative for the same text', async () => {
    const { chat, ids } = await suggested([
      span('Compare plans across five tools.', 'Compare the plans of five CRM tools.'),
      span('Compare plans across five tools.', 'Five CRM tools, plan by plan.'),
    ]);
    expect((await fromModel(chat)).map((item) => item.choose_one)).toEqual([true, true]);
    const result = await agent.suggestions.apply(
      chat.scope,
      target(chat, ids[0]!, await chat.latest()),
    );
    expect({
      outcome: result.outcome,
      author: result.revision?.author,
      status: result.suggestion.status,
      position: result.suggestion.position,
    }).toEqual({
      outcome: 'applied',
      author: 'user',
      status: 'applied',
      position: { start: 15, end: 51 },
    });
    expect(await chat.body()).toBe(
      BODY.replace('Compare plans across five tools.', 'Compare the plans of five CRM tools.'),
    );
    expect(await statusOf(chat, ids[1]!)).toBe('stale');
  });

  it('stales a span a person edited, even where the same text appears again elsewhere', async () => {
    const { chat, ids } = await suggested([
      span('Pro costs $30 a month.', 'Pro costs $30 per user a month.'),
      span('Starter costs $10 a month.', 'Starter costs $10 per user a month.'),
    ]);
    const base = await chat.latest();
    // The Pro sentence moves above the Starter heading: the same text, elsewhere.
    await outputs.edit(chat.scope, chat.chatId, chat.outputId, {
      baseId: base,
      title: 'CRM pricing compared',
      body: BODY.replace('\n\n## Pro\n\nPro costs $30 a month.', '').replace(
        'five tools.',
        'five tools.\n\nPro costs $30 a month.',
      ),
    });
    expect(
      (await fromModel(chat)).map(({ id, status, position }) => ({ id, status, position })),
    ).toEqual([{ id: ids[1], status: 'open', position: { start: 85, end: 111 } }]);
    const stale = await agent.suggestions
      .apply(chat.scope, target(chat, ids[0]!, await chat.latest()))
      .catch((error: unknown) => error);
    expect(stale).toMatchObject({ code: 'suggestion_not_open' });
  });

  it('stales a field suggestion once the field no longer has the value it was made against', async () => {
    const field = (text: string) => ({
      field: 'title',
      new_string: text,
      rule_id: 'search_guidelines.descriptive_title',
      rationale: 'Name the comparison.',
    });
    const { chat, ids } = await suggested([
      field('CRM pricing: five tools compared'),
      field('Compare CRM prices'),
    ]);
    const applied = await agent.suggestions.apply(
      chat.scope,
      target(chat, ids[0]!, await chat.latest()),
    );
    expect(applied.revision?.fields?.title).toBe('CRM pricing: five tools compared');
    expect((await fromModel(chat)).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: ids[0], status: 'applied' },
    ]);
    const events = await db
      .selectFrom('agent_output_suggestion_events')
      .select(['status', 'reason'])
      .where('suggestion_id', '=', ids[1]!)
      .orderBy('sequence')
      .execute();
    expect(events).toEqual([
      { status: 'open', reason: null },
      { status: 'stale', reason: 'field_changed' },
    ]);
  });

  it('stales a suggestion whose section or field dependency changed, and keeps one whose did not', async () => {
    const { chat, ids } = await suggested([
      span('Starter costs $10 a month.', 'Starter is $10 a month.', { depends_on: ['section'] }),
      span('Pro costs $30 a month.', 'Pro is $30 a month.', { depends_on: ['section'] }),
      span('# CRM pricing', '# CRM pricing compared', { depends_on: ['title'] }),
      {
        field: 'title',
        new_string: 'CRM prices compared',
        rule_id: 'search_guidelines.descriptive_title',
        rationale: 'Shorter.',
      },
    ]);
    await outputs.edit(chat.scope, chat.chatId, chat.outputId, {
      baseId: await chat.latest(),
      title: 'CRM pricing compared',
      body: BODY.replace('It suits two users.', 'It suits small teams.'),
    });
    await agent.suggestions.apply(chat.scope, target(chat, ids[3]!, await chat.latest()));
    const statuses = await Promise.all(ids.map((id) => statusOf(chat, id)));
    expect(statuses).toEqual(['stale', 'open', 'stale', 'applied']);
  });
});

describe('Apply all and Dismiss all', () => {
  it('applies non-overlapping ready suggestions in position order and reports what it left', async () => {
    const { chat, ids } = await suggested([
      // Written first, but later on the page: the Starter edit before it changes the body it reads.
      span('Pro costs $30 a month.', 'Pro is $30 a month.', { depends_on: ['body'] }),
      span('Starter costs $10 a month.', 'Starter is $10 a month.'),
      span('Compare plans across five tools.', 'Compare five CRM tools.'),
      span('Compare plans across five tools.', 'Five CRM tools compared.'),
      {
        needs_input: 'Which customer could we quote?',
        rule_id: 'proof.attributed_quotes',
        rationale: 'A named customer adds proof.',
      },
    ]);
    const result = await agent.suggestions.applyAll(chat.scope, {
      chatId: chat.chatId,
      outputId: chat.outputId,
      baseId: await chat.latest(),
    });
    expect({ ...result, revision: result.revision?.body }).toEqual({
      applied: 1,
      left_to_choose: 2,
      needs_input: 1,
      stale: 1,
      revision: BODY.replace('Starter costs $10 a month.', 'Starter is $10 a month.'),
    });
    const statuses = await Promise.all(ids.map((id) => statusOf(chat, id)));
    expect(statuses).toEqual(['stale', 'applied', 'open', 'open', 'open']);

    const dismissed = await agent.suggestions.dismissAll(chat.scope, {
      chatId: chat.chatId,
      outputId: chat.outputId,
      baseId: await chat.latest(),
    });
    // The three left open, and the Site Health advice.
    expect(dismissed).toEqual({ dismissed: 4 });
    expect((await chat.list()).counts).toMatchObject({ open: 0, applied: 1, dismissed: 4 });
  });
});

describe('reverting (E4)', () => {
  it('restores an applied span’s text, and reopens a dismissed suggestion', async () => {
    const { chat, ids } = await suggested([
      span('Starter costs $10 a month.', 'Starter is $10 a month.'),
      span('Pro costs $30 a month.', 'Pro is $30 a month.'),
    ]);
    await agent.suggestions.apply(chat.scope, target(chat, ids[0]!, await chat.latest()));
    await agent.suggestions.dismiss(chat.scope, target(chat, ids[1]!, await chat.latest()));
    const reverted = await agent.suggestions.revert(
      chat.scope,
      target(chat, ids[0]!, await chat.latest()),
    );
    expect({
      outcome: reverted.outcome,
      status: reverted.suggestion.status,
      position: reverted.suggestion.position,
    }).toEqual({ outcome: 'reverted', status: 'open', position: { start: 61, end: 87 } });
    expect(await chat.body()).toBe(BODY);
    const reopened = await agent.suggestions.revert(
      chat.scope,
      target(chat, ids[1]!, await chat.latest()),
    );
    expect({ outcome: reopened.outcome, revision: reopened.revision }).toEqual({
      outcome: 'reverted',
      revision: null,
    });
    // Reopened, the applied one can be applied again.
    const again = await agent.suggestions.apply(
      chat.scope,
      target(chat, ids[0]!, await chat.latest()),
    );
    expect(again.outcome).toBe('applied');
  });

  it('refuses to revert an applied suggestion whose text was edited since', async () => {
    const { chat, ids } = await suggested([
      span('Starter costs $10 a month.', 'Starter is $10 a month.'),
    ]);
    await agent.suggestions.apply(chat.scope, target(chat, ids[0]!, await chat.latest()));
    await outputs.edit(chat.scope, chat.chatId, chat.outputId, {
      baseId: await chat.latest(),
      title: 'CRM pricing compared',
      body: BODY.replace('Starter costs $10 a month.', 'Starter is $12 a month.'),
    });
    const response = await app.request(
      `/api/v1/agent/chats/${chat.chatId}/outputs/${chat.outputId}/suggestions/${ids[0]}/revert`,
      {
        method: 'POST',
        headers: chat.headers,
        body: JSON.stringify({ base_revision_id: await chat.latest() }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'agent_suggestion_conflict',
        message:
          'The text this suggestion changed was edited after it was applied, so reverting it would undo that edit.',
      },
    });
    expect(await chat.body()).toBe(
      BODY.replace('Starter costs $10 a month.', 'Starter is $12 a month.'),
    );
  });
});

describe('guards', () => {
  it('refuses a change made against an older revision, and one while a turn runs', async () => {
    const { chat, ids } = await suggested([
      span('Starter costs $10 a month.', 'Starter is $10 a month.'),
    ]);
    const old = await chat.latest();
    await outputs.edit(chat.scope, chat.chatId, chat.outputId, {
      baseId: old,
      title: 'CRM pricing compared',
      body: BODY.replace('# CRM pricing', '# CRM prices'),
    });
    const apply = (baseId: string) =>
      app.request(
        `/api/v1/agent/chats/${chat.chatId}/outputs/${chat.outputId}/suggestions/${ids[0]}/apply`,
        {
          method: 'POST',
          headers: chat.headers,
          body: JSON.stringify({ base_revision_id: baseId }),
        },
      );
    const conflict = await apply(old);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'agent_output_conflict' } });

    await chat.ask('Any other ideas?');
    const busy = await apply(await chat.latest());
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: 'agent_run_active' } });
    expect(await statusOf(chat, ids[0]!)).toBe('open');
  });

  it('lists and changes suggestions only in the workspace that owns the chat', async () => {
    const { chat, ids } = await suggested([
      span('Starter costs $10 a month.', 'Starter is $10 a month.'),
    ]);
    const path = `/api/v1/agent/chats/${chat.chatId}/outputs/${chat.outputId}/suggestions`;
    const own = agentSuggestionsPageSchema.parse(
      await (await app.request(path, { headers: chat.headers })).json(),
    );
    // Each suggestion carries its rule's source and strength, as stored when it was made.
    expect(
      own.items.map(({ id, rule_id, category, guidance }) => ({ id, rule_id, category, guidance })),
    ).toEqual([
      {
        id: ids[0],
        rule_id: 'clarity.fluent_prose',
        category: 'clarity',
        guidance: {
          strength: 'heuristic',
          source_label: 'Aggarwal et al. 2024, GEO (research)',
          source_url: 'https://arxiv.org/abs/2311.09735',
        },
      },
      {
        id: expect.any(String),
        rule_id: 'technical.meta_description_present',
        category: 'search_guidelines',
        guidance: {
          strength: 'recommendation',
          source_label: 'Google Search Central: snippets and meta descriptions',
          source_url: 'https://developers.google.com/search/docs/appearance/snippet',
        },
      },
    ]);
    const other = await project();
    expect((await app.request(path, { headers: other.headers })).status).toBe(404);
    const applied = await app.request(`${path}/${ids[0]}/apply`, {
      method: 'POST',
      headers: other.headers,
      body: JSON.stringify({ base_revision_id: own.revision_id }),
    });
    expect(applied.status).toBe(404);
    await expect(
      agent.suggestions.apply(other.scope, target(chat, ids[0]!, own.revision_id)),
    ).rejects.toMatchObject({ status: 404 });
    expect(await statusOf(chat, ids[0]!)).toBe('open');
  });
});
