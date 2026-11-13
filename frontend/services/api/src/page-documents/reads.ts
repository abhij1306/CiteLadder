/**
 * Persisted reads of page fetches: a chat's fetch state and a snapshot's
 * page-local checks for the Agent's context. Reads never fetch.
 */
import { z } from 'zod';

import { agentPageFetchSchema } from '@citeladder/contracts/agent';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ruleTitle } from '../site-health/reads/rules.ts';
import { chatPageFetch } from './keys.ts';

const outcomeSchema = z.enum(policy.content_optimization.page_fetch.outcomes);
const FAILING: ReadonlySet<string> = new Set(policy.site_health.reads.failing_outcomes);
const checkSchema = z.object({
  rule_id: z.string(),
  category: z.string(),
  severity: z.string(),
  finding_class: z.string(),
  outcome: z.string(),
  reason_code: z.string(),
  display_applicability: z.boolean(),
});

/**
 * The checks the SEO tab shows (E5): those Site Health displays, failing ones
 * first, each in catalog order, with the rule's title.
 */
function shownChecks(evaluations: unknown) {
  const checks = z
    .array(checkSchema)
    .parse(evaluations ?? [])
    .filter((check) => check.display_applicability)
    .map((check) => ({
      rule_id: check.rule_id,
      label: ruleTitle(check.rule_id),
      severity: check.severity,
      outcome: check.outcome,
      failing: FAILING.has(check.outcome),
    }));
  return [...checks.filter((check) => check.failing), ...checks.filter((check) => !check.failing)];
}

/** The chat's latest snapshot, newest first. */
function latestSnapshot(db: Database, workspaceId: string, chatId: string) {
  return db
    .selectFrom('page_snapshots')
    .select(['id', 'outcome', 'fetched_at', 'evaluations'])
    .where('workspace_id', '=', workspaceId)
    .where('chat_id', '=', chatId)
    .orderBy('fetched_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/**
 * A page chat's fetch: `reading` while its task is active, then how it ended.
 * A task that ended without a snapshot (an internal failure its compensation
 * has not recorded yet) reads as failed, never as still reading. Null for a
 * chat that never fetched a page.
 */
export async function pageFetchView(
  db: Database,
  chat: { workspace_id: string; id: string },
): Promise<z.infer<typeof agentPageFetchSchema> | null> {
  const snapshot = await latestSnapshot(db, chat.workspace_id, chat.id);
  if (snapshot)
    return {
      status: 'done',
      outcome: outcomeSchema.parse(snapshot.outcome),
      fetched_at: snapshot.fetched_at.toISOString(),
      checks: shownChecks(snapshot.evaluations),
    };
  const task = await chatPageFetch(db, chat.workspace_id, chat.id);
  if (!task) return null;
  if (policy.task_queue.active.includes(task.status)) return { status: 'reading' };
  return { status: 'done', outcome: 'failed', fetched_at: null, checks: [] };
}

/**
 * One snapshot of the project as Agent context: the page it fetched, when, and
 * the page-local Site Health checks that did not pass on it. Null when the
 * snapshot is not the project's.
 */
export async function fetchedPageContext(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  snapshotId: string,
) {
  const snapshot = await db
    .selectFrom('page_snapshots')
    .select([
      'requested_url',
      'final_url',
      'fetched_at',
      'outcome',
      'outcome_reason',
      'page_kind',
      'evaluations',
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', snapshotId)
    .executeTakeFirst();
  if (!snapshot) return null;
  const checks = z.array(checkSchema).parse(snapshot.evaluations ?? []);
  return {
    requested_url: snapshot.requested_url,
    final_url: snapshot.final_url,
    fetched_at: snapshot.fetched_at.toISOString(),
    outcome: snapshot.outcome,
    outcome_reason: snapshot.outcome_reason,
    page_kind: snapshot.page_kind,
    // Re-run on this fetch; checks that need the whole crawl keep the crawl's finding.
    scope: 'page-local Site Health checks on the fetched page',
    checks_run: checks.length,
    failing_checks: checks
      .filter((check) => check.display_applicability && FAILING.has(check.outcome))
      .map(({ display_applicability: _shown, ...check }) => check),
  };
}
