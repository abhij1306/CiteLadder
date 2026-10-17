import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../src/db/database.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import {
  seedOpportunityScenario,
  actionRow,
  opportunityRow,
  snapshotRow,
} from './opportunity-fixtures.ts';
import type { OpportunitySeed } from './opportunity-fixtures.ts';

export type ActionSeed = OpportunitySeed & {
  actions: Record<string, string>;
  members: Record<string, string>;
};

async function seed(db: Database, content: boolean): Promise<ActionSeed> {
  const scn = await seedOpportunityScenario(db, content);
  return db.transaction().execute(async (trx) => {
    const scope = { workspace_id: scn.workspace_id, project_id: scn.project_id };
    const snapshot = snapshotRow(scope, {
      audit_id: scn.audit_id,
      site_crawl_id: scn.crawl_id,
      total_count: 4,
      source_analysis_ids: JSON.stringify([scn.analysis0_id]),
      source_issue_ids: JSON.stringify(
        [scn.issue_structured_id, scn.issue_content_id].sort((left, right) =>
          left.localeCompare(right),
        ),
      ),
    });
    await trx.insertInto('opportunity_snapshots').values(snapshot).execute();
    const prompt = {
      target_key: `prompt:${scn.prompt0_id}`,
      target_prompt_id: scn.prompt0_id,
      target_theme: 'crm',
      opportunity_type: 'visibility',
      evidence: JSON.stringify({ prompt_text: 'best crm for small teams' }),
      source_analysis_ids: JSON.stringify([scn.analysis0_id]),
      source_metric_ids: JSON.stringify([scn.metric_snapshot_id]),
      source_issue_ids: '[]',
    };
    const specs = [
      opportunityRow(scope, {
        ...prompt,
        rule_id: 'brand_absent_high_value_prompt',
        severity: 'high',
        priority_score: 120,
        title: 'brand_absent_high_value_prompt',
      }),
      opportunityRow(scope, {
        ...prompt,
        rule_id: 'owned_page_not_cited',
        severity: 'medium',
        priority_score: 80,
        title: 'owned_page_not_cited',
      }),
      opportunityRow(scope, {
        rule_id: 'missing_structured_data',
        title: 'missing_structured_data',
        severity: 'medium',
        priority_score: 20,
        opportunity_type: 'site',
        target_key: 'url:https://acme.test/a',
        target_url: 'https://acme.test/a',
        evidence: JSON.stringify({ issue_rule_id: 'aeo.structured_data_present' }),
        source_issue_ids: JSON.stringify([scn.issue_structured_id]),
      }),
      opportunityRow(scope, {
        rule_id: 'content_structure_incomplete',
        title: 'content_structure_incomplete',
        severity: 'low',
        priority_score: 10,
        opportunity_type: 'site',
        target_key: 'url:https://acme.test/b',
        target_url: 'https://acme.test/b',
        evidence: JSON.stringify({ issue_rule_id: 'aeo.answer_first' }),
        source_issue_ids: JSON.stringify([scn.issue_content_id]),
      }),
    ];
    await trx.insertInto('opportunities').values(specs).execute();
    const actions: Record<string, string> = {};
    const members: Record<string, string> = {};
    for (const [kind, key, url, promptId, rules, family] of [
      [
        'page',
        'page:acme.test/a',
        'https://acme.test/a',
        null,
        ['missing_structured_data'],
        'site_health',
      ],
      [
        'page',
        'page:acme.test/b',
        'https://acme.test/b',
        null,
        ['content_structure_incomplete'],
        'site_health',
      ],
      [
        'prompt',
        `prompt:${scn.prompt0_id}`,
        null,
        scn.prompt0_id,
        ['brand_absent_high_value_prompt', 'owned_page_not_cited'],
        'ai_visibility',
      ],
    ] as const) {
      const selectedRules: readonly string[] = rules;
      const rows = specs.filter((row) => selectedRules.includes(row.rule_id));
      const action = actionRow(scope, {
        group_key: key,
        target_kind: kind,
        target_label: url ?? 'best crm for small teams',
        target_url: url,
        target_prompt_id: promptId,
        priority_score: Math.max(...rows.map((row) => row.priority_score)),
        families: JSON.stringify([family]),
        member_opportunity_ids: JSON.stringify(rows.map((row) => row.id)),
        opportunity_snapshot_id: snapshot.id,
      });
      await trx.insertInto('actions').values(action).execute();
      for (const row of rows) {
        await trx
          .updateTable('opportunities')
          .set({ action_id: action.id })
          .where('id', '=', row.id)
          .execute();
        actions[row.rule_id] = action.id;
        members[row.rule_id] = row.id;
      }
    }
    return { ...scn, actions, members };
  });
}

function revision(db: Database, workspace: string, project: string, action: string, phase: string) {
  return db.transaction().execute(async (trx) => {
    const scope = { workspace_id: workspace, project_id: project };
    const now = new Date();
    const chatId = randomUUID(),
      outputId = randomUUID(),
      revisionId = randomUUID();
    await trx
      .insertInto('agent_chats')
      .values({
        ...scope,
        id: chatId,
        action_id: action,
        title: 'Page edits',
        context_refs: '{}',
        turn_count: 0,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await trx
      .insertInto('agent_outputs')
      .values({
        ...scope,
        id: outputId,
        chat_id: chatId,
        action_id: action,
        kind: 'page_edits',
        skill_id: 'gsc_optimize',
        phase,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await trx
      .insertInto('agent_output_revisions')
      .values({
        ...scope,
        id: revisionId,
        output_id: outputId,
        number: 1,
        author: 'run',
        phase,
        title: 'Page edits',
        body: 'Rewrite the title.',
        source_refs: '[]',
        created_at: now,
      })
      .execute();
    return revisionId;
  });
}

export async function sourcePage(
  db: Database,
  scope: { workspace_id: string; project_id: string },
  url: string,
  inspected = false,
) {
  const id = randomUUID();
  const hash = createHash('sha256').update(url).digest('hex');
  await db
    .insertInto('source_pages')
    .values({
      ...scope,
      id,
      canonical_url: url,
      url_hash: hash,
      registrable_domain: new URL(url).hostname,
      inspection_state: inspected ? 'inspected' : 'not_inspected',
      page_format: 'unresolved',
      recurrence_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  return { id, hash };
}

async function observation(
  db: Database,
  scope: { workspace_id: string; project_id: string },
  pageId: string,
  present: boolean,
) {
  const page = await db
    .selectFrom('source_pages')
    .select('canonical_url')
    .where('id', '=', pageId)
    .where('workspace_id', '=', scope.workspace_id)
    .where('project_id', '=', scope.project_id)
    .executeTakeFirstOrThrow();
  const moment = new Date(Date.now() + (present ? 4 * 86400000 : 0));
  const snapshotId = randomUUID();
  await db
    .insertInto('source_page_snapshots')
    .values({
      ...scope,
      id: snapshotId,
      source_page_id: pageId,
      requested_url: page.canonical_url,
      final_url: page.canonical_url,
      outcome: 'inspected',
      body_bytes: 0,
      extracted_chars: 5000,
      fetched_at: moment,
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('source_page_entity_presences')
    .values({
      ...scope,
      id: randomUUID(),
      source_page_id: pageId,
      snapshot_id: snapshotId,
      entity_kind: 'brand',
      entity_name: 'Acme',
      presence: present ? 'present' : 'not_detected',
      match_method: present ? 'exact_alias' : 'none',
      match_count: present ? 2 : 0,
      roster_version: 'roster-fixed',
      created_at: new Date(),
    })
    .execute();
  return { snapshot_id: snapshotId, observed_at: moment.toISOString() };
}

async function standaloneAction(
  db: Database,
  member: ReturnType<typeof opportunityRow>,
  kind: string,
) {
  await db.insertInto('opportunities').values(member).execute();
  const action = actionRow(
    { workspace_id: member.workspace_id, project_id: member.project_id },
    {
      group_key: `${kind}:${member.target_key}`,
      target_kind: kind,
      target_label: member.target_url ?? member.title,
      target_url: member.target_url,
      member_opportunity_ids: JSON.stringify([member.id]),
    },
  );
  await db.insertInto('actions').values(action).execute();
  await db
    .updateTable('opportunities')
    .set({ action_id: action.id })
    .where('id', '=', member.id)
    .execute();
  return action.id;
}

/** Native persisted fixtures; one disposable database pool per invocation. */
export async function actionFixture<T>(phase: string, ...args: string[]): Promise<T> {
  const db = testDatabase();
  try {
    if (phase === 'seed' || phase === 'content') return (await seed(db, phase === 'content')) as T;
    if (phase === 'revision')
      return (await revision(db, args[0]!, args[1]!, args[2]!, args[3]!)) as T;
    return await db.transaction().execute(async (trx) => {
      const scope = { workspace_id: args[0]!, project_id: args[1]! };
      if (phase === 'observe') return (await observation(trx, scope, args[2]!, true)) as T;
      if (phase === 'sibling') {
        scope.project_id = await new VisibilityFixtures(trx).project(
          scope.workspace_id,
          'https://sibling.test/',
        );
        await trx.insertInto('opportunity_snapshots').values(snapshotRow(scope)).execute();
        const id = await standaloneAction(
          trx,
          opportunityRow(scope, {
            rule_id: 'high_impression_low_ctr',
            opportunity_type: 'traffic',
            severity: 'high',
            priority_score: 30,
            title: 'Improve CTR',
            target_key: 'query:sibling',
          }),
          'query',
        );
        return { project_id: scope.project_id, action_id: id } as T;
      }
      if (phase !== 'earned') throw new Error(`Unknown Action fixture phase: ${phase}`);
      const url = 'https://review.example/best-tools';
      const page = await sourcePage(trx, scope, url, true);
      const snapshot = await observation(trx, scope, page.id, false);
      const promptId = randomUUID();
      const actionId = await standaloneAction(
        trx,
        opportunityRow(scope, {
          rule_id: 'earned_page_acquire_listing',
          opportunity_type: 'visibility',
          severity: 'high',
          priority_score: 30,
          title: 'Acquire listing',
          target_key: `earned-page:${page.hash}`,
          target_url: url,
          evidence: JSON.stringify({
            content_handoff: {
              url_hash: page.hash,
              snapshot_id: snapshot.snapshot_id,
              page_entities: [{ entity_kind: 'brand', entity_name: 'Acme' }],
              affected_prompts: [{ prompt_id: promptId, text: 'best analytics tools' }],
            },
          }),
        }),
        'earned_page',
      );
      return { action_id: actionId, prompt_id: promptId } as T;
    });
  } finally {
    await db.destroy();
  }
}
