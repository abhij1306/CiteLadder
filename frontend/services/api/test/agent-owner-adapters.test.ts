import { readdir, readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as sharedTools from '../src/mcp/tools.ts';
import { AgentFixtures, reply, save, scripted, toolUse, type Response } from './agent-support.ts';
import { testDatabase } from './support.ts';
import { agentTools, smallerLimit } from '../src/agent/tool-adapters.ts';
import { attachAgentTarget } from '../src/agent/target-adapter.ts';
import { attachOrCreateAction } from '../src/opportunities/actions.ts';
import { readChat } from '../src/agent/reads.ts';
import { loadSkillCatalog } from '../src/agent/skills.ts';
import { agentSettings } from '../src/agent/config.ts';
import { AgentQueue } from '../src/agent/queue.ts';
import { AgentOutputs } from '../src/agent/outputs.ts';
import { readAgentContext } from '../src/agent/context-adapter.ts';
import { SiteFixtures } from './site-health-fixtures.ts';

describe('Agent bindings to the evidence and Action owners', () => {
  const db = testDatabase(),
    fixtures = new AgentFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  const signal = () => AbortSignal.timeout(5000);
  it('shrinks a page only to a size the tool accepts', () => {
    const shape = (name: string) =>
      sharedTools.definitions[name as keyof typeof sharedTools.definitions].schema.shape as Record<
        string,
        Parameters<typeof smallerLimit>[0]
      >;
    // read_performance takes fixed page sizes: 25 steps down to 10, and 10 has no smaller one.
    // A short page (18 of 25 rows) still reaches 10, though 10 is more than half of 18.
    const performance = shape('read_performance').limit!;
    expect([25, 18, 10].map((rows) => smallerLimit(performance, rows))).toEqual([10, 10, null]);
    const portfolio = shape('read_prompt_portfolio').limit!;
    expect([smallerLimit(portfolio, 25), smallerLimit(portfolio, 1)]).toEqual([12, null]);
  });
  it('sizes page reads to the turn budget while retaining owner cursors and every row', async () => {
    const site = new SiteFixtures(db);
    try {
      const scope = await site.crawl();
      const expected = [];
      for (let index = 0; index < 12; index++) {
        expected.push(
          (
            await site.page(
              scope,
              `/page-${index}`,
              { title: 'Title '.repeat(50) },
              { observed: true },
            )
          ).id,
        );
      }
      const tools = agentTools(db);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const outcome = await tools.execute(
          db,
          scope,
          'read_site_pages',
          { crawl_id: scope.crawlId, limit: 100, cursor },
          signal(),
          5000,
        );
        expect(outcome.status).toBe('completed');
        expect(outcome.omissions).toEqual([]);
        const page = JSON.parse(outcome.text);
        expect(page.items.length).toBeGreaterThan(0);
        seen.push(...page.items.map((item: { site_url_id: string }) => item.site_url_id));
        cursor = page.pagination.next_cursor;
      } while (cursor && seen.length <= expected.length);
      expect(seen.sort()).toEqual(expected.sort());
    } finally {
      await site.cleanup();
    }
  });
  it('offers every read tool the packaged methodologies name, and no project picker or MCP App view', async () => {
    const packaged = await loadSkillCatalog(agentSettings({}).skillsDirectory);
    const named = new Set(
      [packaged.operatingContract, ...[...packaged.skills.values()].map((skill) => skill.body)]
        .flatMap((body) => [...body.matchAll(/`((?:read|list|get)_[a-z_]+)`/gu)])
        .map((match) => match[1]!),
    );
    const offered = agentTools(db);
    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter((name) => !offered.has(name))).toEqual([]);
    const chatOnly = ['list_projects', 'render_visibility', 'render_site_health', 'open_analytics'];
    expect(chatOnly.filter((name) => offered.has(name))).toEqual([]);
    // The public plugin's twins call the same catalogue.
    const plugin = new URL('../../../../plugins/citeladder/skills/', import.meta.url);
    const pluginNamed = new Set(
      (
        await Promise.all(
          (await readdir(plugin)).map((skill) =>
            readFile(new URL(`${skill}/SKILL.md`, plugin), 'utf8'),
          ),
        )
      ).flatMap((body) =>
        [...body.matchAll(/`((?:read|list|get|render|open)_[a-z_]+|search|fetch)`/gu)].map(
          (match) => match[1]!,
        ),
      ),
    );
    expect(pluginNamed.size).toBeGreaterThan(0);
    expect(
      [...pluginNamed].filter((name) => !Object.hasOwn(sharedTools.definitions, name)),
    ).toEqual([]);
  });
  it('pins shared MCP reads and fetches to one project and rechecks the member', async () => {
    const scope = await fixtures.scope(),
      foreign = await fixtures.scope();
    const sibling = await fixtures.project(scope.workspaceId);
    const tools = agentTools(db);
    const fetched = await tools.execute(
      db,
      scope,
      'fetch',
      { id: `citeladder://project/${scope.projectId}` },
      signal(),
    );
    expect(fetched.status).toBe('completed');
    expect(fetched.refs).toEqual([
      { id: scope.projectId, record_uri: `citeladder://project/${scope.projectId}` },
    ]);
    expect(JSON.parse(fetched.text).metadata.project_id).toBe(scope.projectId);
    expect(await tools.execute(db, scope, 'list_projects', {}, signal())).toMatchObject({
      status: 'refused',
    });
    expect(await tools.execute(db, scope, 'read_demand', {}, signal())).toMatchObject({
      status: 'unavailable',
      omissions: [{ reason: 'no_demand_snapshot' }],
    });
    expect(
      await tools.execute(db, scope, 'read_demand', { project_id: foreign.projectId }, signal()),
    ).toMatchObject({ status: 'refused' });
    for (const id of [sibling, foreign.projectId]) {
      expect(
        await tools.execute(db, scope, 'fetch', { id: `citeladder://project/${id}` }, signal()),
      ).toMatchObject({ status: 'refused', refs: [] });
    }
    await db
      .deleteFrom('workspace_members')
      .where('workspace_id', '=', scope.workspaceId)
      .where('user_id', '=', scope.userId)
      .execute();
    await expect(tools.execute(db, scope, 'read_demand', {}, signal())).rejects.toMatchObject({
      status: 404,
    });
  });
  it('fails unknown reader availability while preserving observed zero and stateless search results', async () => {
    const scope = await fixtures.scope();
    const tools = agentTools(db);
    const read = vi.spyOn(sharedTools, 'dispatchTool');
    try {
      read.mockResolvedValueOnce({ state: 'unexpected' });
      expect(await tools.execute(db, scope, 'read_demand', {}, signal())).toMatchObject({
        status: 'failed',
      });
      read.mockResolvedValueOnce({ state: 'available', artifact_refs: [{ wrong: 'malformed' }] });
      expect(await tools.execute(db, scope, 'read_demand', {}, signal())).toMatchObject({
        status: 'failed',
      });
      read.mockResolvedValueOnce({ state: 'observed_zero', items: [] });
      const zero = await tools.execute(
        db,
        scope,
        'read_query_evidence',
        { window_start: '2026-09-01', window_end: '2026-09-02' },
        signal(),
      );
      expect(zero.status).toBe('completed');
      expect(JSON.parse(zero.text).state).toBe('observed_zero');
      read.mockResolvedValueOnce({ results: [] });
      expect(
        await tools.execute(db, scope, 'search', { query: 'Nothing' }, signal()),
      ).toMatchObject({ status: 'completed' });
    } finally {
      read.mockRestore();
    }
  });
  it('reads the Action owner and refuses a sibling Action even inside the same workspace', async () => {
    const scope = await fixtures.scope(),
      sibling = await fixtures.project(scope.workspaceId);
    const attach = (projectId: string, topic: string) =>
      db
        .transaction()
        .execute((trx) =>
          attachOrCreateAction(trx, { ...scope, projectId }, 'planned_page', topic, scope.userId),
        );
    const action = await attach(scope.projectId, 'Buyer guide'),
      other = await attach(sibling, 'Other guide');
    const tools = agentTools(db);
    const own = await tools.execute(db, scope, 'read_actions', { action_id: action.id }, signal());
    expect(own.status).toBe('completed');
    expect(JSON.parse(own.text).action).toMatchObject({
      id: action.id,
      target_label: 'Buyer guide',
    });
    expect(
      await tools.execute(db, scope, 'read_actions', { action_id: other.id }, signal()),
    ).toMatchObject({ status: 'refused', text: 'Action was not found in this project' });
    expect(
      JSON.parse((await tools.execute(db, scope, 'read_actions', {}, signal())).text).items,
    ).toEqual([expect.objectContaining({ id: action.id })]);
  });
  it('replays earlier reads to the model and lists only this turn’s reads as sources', async () => {
    const scope = await fixtures.scope();
    const tools = agentTools(db);
    const store = fixtures.store({ registryVersion: tools.version });
    const queue = new AgentQueue(db, 30);
    const uri = `citeladder://project/${scope.projectId}`;
    const fetch = (id: string) => [toolUse('fetch', { id: uri }, id)];
    const answer = reply(`Project evidence ${uri}`);
    const first = await store.enqueue(scope, { key: randomUUID(), message: 'Explain project' });
    const execute = async (responses: Response[], inspect?: Parameters<typeof scripted>[1]) => {
      const claimed = await queue.claim('evidence-continuity', [scope.workspaceId]);
      const lease = await queue.start(claimed!, 'evidence-continuity');
      await fixtures.runtime(scope, scripted(responses, inspect), { tools }).execute(lease);
      return readChat(db, scope, first.chat_id);
    };
    expect((await execute([fetch('call_fetch'), answer])).messages.at(-1)?.evidence_refs).toEqual([
      uri,
    ]);
    await store.enqueue(scope, { key: randomUUID(), chatId: first.chat_id, message: 'Follow up' });
    const replayedResults: string[] = [];
    const withoutRead = await execute([answer], async (request) => {
      for (const message of request.messages)
        for (const block of message.content)
          if (block.type === 'tool_result') replayedResults.push(String(block.tool_use_id));
    });
    // The model still holds the earlier result; the reply cites only this turn's reads.
    expect(replayedResults).toEqual(['call_fetch']);
    expect(withoutRead.messages.at(-1)?.evidence_refs).toEqual([]);
    expect(withoutRead.messages.at(-1)?.content).toBe('Project evidence');
    await store.enqueue(scope, {
      key: randomUUID(),
      chatId: first.chat_id,
      message: 'Read it again',
    });
    const refreshed = await execute([fetch('call_again'), answer]);
    expect(refreshed.messages.at(-1)?.evidence_refs).toEqual([uri]);
    expect(refreshed.latest_run?.progress.filter((step) => step.tool === 'fetch')).toHaveLength(1);
  });
  it('carries an Action through outline approval, user edit, refinement and an exact next-step revision', async () => {
    const scope = await fixtures.scope();
    const action = await db
      .transaction()
      .execute((trx) =>
        attachOrCreateAction(trx, scope, 'planned_page', 'Buyer guide', scope.userId),
      );
    const tools = agentTools(db);
    const store = fixtures.store({ registryVersion: tools.version, context: readAgentContext });
    const queue = new AgentQueue(db, 30);
    /** The opening message the model received on a turn's first call. */
    const opened: string[] = [];
    const execute = async (responses: Response[]) => {
      const claimed = await queue.claim('workflow-acceptance', [scope.workspaceId]);
      const lease = await queue.start(claimed!, 'workflow-acceptance');
      opened.length = 0;
      const model = scripted(responses, async (request, ordinal) => {
        if (ordinal === 1) opened.push(JSON.stringify(request.messages.at(-1)));
      });
      await fixtures.runtime(scope, model, { tools }).execute(lease);
      return readChat(db, scope, claimed!.chat_id);
    };
    const first = await store.enqueue(scope, {
      key: randomUUID(),
      actionId: action.id,
      skillId: 'content',
      message: 'Write a buyer guide',
    });
    const outlined = await execute([save('draft', 'Proposed outline')]);
    expect(opened[0]).toContain(action.id);
    const outline = outlined.output!.latest_revision!;
    expect(outline.phase).toBe('outline');
    await store.approveOutline(scope, first.chat_id, outline.id, randomUUID());
    const drafted = await execute([save('draft', 'Approved draft')]);
    const edited = await new AgentOutputs(db).edit(
      scope,
      first.chat_id,
      drafted.output!.latest_revision!.id,
      'Buyer guide',
      'User edited draft',
    );
    expect((await readChat(db, scope, first.chat_id)).output?.message_id).toBe(
      drafted.messages.at(-1)!.id,
    );
    await store.enqueue(scope, {
      key: randomUUID(),
      chatId: first.chat_id,
      message: 'Refine my edit',
    });
    const refined = await execute([save('draft', 'Refined accepted guide')]);
    // The user's edit is new to the model, so the turn supplies it.
    expect(opened[0]).toContain('User edited draft');
    const accepted = refined.output!.latest_revision!;
    expect(accepted.parent_revision_id).toBe(edited.id);
    expect(refined.output!.message_id).toBe(refined.messages.at(-1)!.id);
    await store.enqueue(scope, {
      key: randomUUID(),
      message: 'Plan distribution',
      skillId: 'plan',
      refs: {
        output_revision_reference: { output_id: refined.output!.id, revision_id: accepted.id },
      },
    });
    const next = await execute([save('final', 'Distribution plan')]);
    expect(opened[0]).toContain(accepted.id);
    expect(opened[0]).toContain('Refined accepted guide');
    expect(next.output?.kind).toBe('plan');
    expect(next.chat.id).not.toBe(first.chat_id);
  });
  it('attaches concurrent same-target outputs once and preserves invalid-target work', async () => {
    const scope = await fixtures.scope();
    const target = 'https://acme.example/pricing';
    const saved = await Promise.all(
      [0, 1].map(() =>
        db
          .transaction()
          .execute((trx) => attachOrCreateAction(trx, scope, 'page', target, scope.userId)),
      ),
    );
    expect(saved[0]!.id).toBe(saved[1]!.id);
    await expect(
      db
        .transaction()
        .execute((trx) =>
          attachOrCreateAction(
            trx,
            scope,
            'page',
            'https://sub.acme.example/pricing',
            scope.userId,
          ),
        ),
    ).rejects.toThrow('outside');
    const { run, lease } = await fixtures.claimed(scope, { skillId: 'content' });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('outline', 'Evidence-grounded guide', {
            title: 'Guide',
            target_kind: 'planned_page',
            target: 'Buyer guide',
          }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(lease);
    const chat = await readChat(db, scope, run.chat_id);
    expect(chat.output).toMatchObject({
      target_kind: 'planned_page',
      target_label: 'Buyer guide',
      format_id: null,
    });
    const actionId = chat.output?.action_id;
    expect(actionId).toBeTruthy();
    const next = await fixtures.claimed(scope, { chatId: run.chat_id });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('outline', 'Revised guide', {
            title: 'Guide',
            target_kind: 'page',
            target: 'https://other.test/page',
          }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(next.lease);
    expect((await readChat(db, scope, run.chat_id)).output?.action_id).toBe(actionId);
    const invalid = await fixtures.claimed(scope, { skillId: 'content' });
    await fixtures
      .runtime(
        scope,
        scripted([
          save('outline', 'Saved for retargeting', {
            title: 'Guide',
            target_kind: 'page',
            target: 'https://other.test/page',
          }),
        ]),
        { attachTarget: attachAgentTarget },
      )
      .execute(invalid.lease);
    expect((await readChat(db, scope, invalid.run.chat_id)).output).toMatchObject({
      action_id: null,
      latest_revision: { body: 'Saved for retargeting' },
    });
  });
});
