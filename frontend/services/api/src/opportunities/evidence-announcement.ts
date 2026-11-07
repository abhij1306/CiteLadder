/**
 * New persisted evidence, announced once by the owner that committed it: the
 * Opportunity refresh it feeds and, while a declaration is still inside its
 * window, the re-check of declared work. Callers announce in the transaction
 * that persisted the evidence; nothing here reads a provider.
 */
import { sql, type Transaction } from 'kysely';
import type { Database } from '../db/database.ts';
import { utcText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import type { DB } from '../generated/db-schema.ts';
import type { SourceKind } from './checks/kind.ts';
import { enqueueImplementationVerification, enqueueOpportunityRefresh } from './enqueue.ts';
import type { Scope } from './sources.ts';

type Evidence = { kind: SourceKind; id: string };
type Announcement = {
  /**
   * The refresh this evidence triggers when it is not the evidence itself, or
   * null when Demand re-interprets first and carries the refresh downstream.
   */
  refresh?: { kind: string; id: string } | null;
  /** Separates repeated settlements of one source; a terminal source settles once. */
  revision?: string;
  /** Defaults to the analytics task attempt budget. */
  maxAttempts?: number;
};

export async function announceEvidence(
  db: Database | Transaction<DB>,
  scope: Scope,
  evidence: Evidence,
  options: Announcement = {},
) {
  const refresh = options.refresh === undefined ? evidence : options.refresh;
  const shared = { ...scope, maxAttempts: options.maxAttempts };
  if (refresh)
    await enqueueOpportunityRefresh(db, {
      ...shared,
      triggerKind: refresh.kind,
      triggerId: refresh.id,
    });
  await enqueueImplementationVerification(db, {
    ...shared,
    triggerKind: evidence.kind,
    triggerId: evidence.id,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
  });
}

type ObservedAt = (
  db: Database,
  scope: WorkspaceScope,
  projectId: string,
  id: string,
) => Promise<string | null | undefined>;

/** When each kind of evidence became terminal: what verification measures from. */
const OBSERVED_AT: Record<SourceKind, ObservedAt> = {
  site_crawl: async (db, scope, projectId, id) =>
    (
      await scope
        .selectFrom(db, 'site_crawls')
        .select(utcText(sql.ref('completed_at')).as('time'))
        .where('project_id', '=', projectId)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time,
  audit: async (db, scope, projectId, id) =>
    (
      await scope
        .selectFrom(db, 'audits')
        .select(utcText(sql.ref('completed_at')).as('time'))
        .where('project_id', '=', projectId)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time,
  traffic_snapshot: async (db, scope, projectId, id) =>
    (
      await scope
        .selectFrom(db, 'traffic_snapshots')
        .select(utcText(sql.ref('created_at')).as('time'))
        .where('project_id', '=', projectId)
        .where('id', '=', id)
        .executeTakeFirst()
    )?.time,
  search_intelligence_dataset: async (db, scope, projectId, id) =>
    (
      await scope
        .selectFrom(db, 'search_intelligence_datasets')
        .select(utcText(sql.ref('published_at')).as('time'))
        .where('project_id', '=', projectId)
        .where('id', '=', id)
        .where('status', '=', 'published')
        .executeTakeFirst()
    )?.time,
};

export const isEvidenceKind = (kind: string): kind is SourceKind =>
  Object.hasOwn(OBSERVED_AT, kind);

/** The announced evidence's terminal instant (UTC ISO), or null before it is terminal. */
export async function evidenceObservedAt(
  db: Database,
  scope: Scope,
  evidence: Evidence,
): Promise<string | null> {
  const time = await OBSERVED_AT[evidence.kind](
    db,
    new WorkspaceScope(scope.workspaceId),
    scope.projectId,
    evidence.id,
  );
  return time ? `${time}Z` : null;
}
