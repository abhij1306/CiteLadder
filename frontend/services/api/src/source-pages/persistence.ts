/** Append an immutable reading and update only its lease-fenced page projection. */
import { randomUUID } from 'node:crypto';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import type { SourceScope } from './admission.ts';
import type { ExtractedPage } from './extract.ts';
import type { assessPage } from './assessment.ts';
import { lockOwnedTask } from './task-fence.ts';

export type FetchOutcome = {
  outcome: 'inspected' | 'blocked' | 'failed';
  requestedUrl: string;
  finalUrl?: string;
  status?: number;
  type?: string;
  charset?: string;
  bytes?: number;
  redirects?: string[];
  headers?: Record<string, string>;
  robots?: string;
  reason?: string;
};
const strength = policy.source_pages.format_method_strength;
const rank = (method: string | null) => {
  const index = strength.indexOf(method ?? '');
  return index < 0 ? strength.length : index;
};

type InspectionInput = {
  scope: SourceScope;
  pageId: string;
  lease: Date | null;
  fetch: FetchOutcome;
  auditId: string;
  roster: string;
  extracted?: ExtractedPage;
  assessment?: ReturnType<typeof assessPage>;
};
export function recordInspection(db: Database, task: QueueTask, input: InspectionInput) {
  const { scope, pageId, lease, fetch, auditId, roster, extracted, assessment } = input;
  return db.transaction().execute(async (trx) => {
    if (!(await lockOwnedTask(trx, task))) return null;
    const audit = await trx
      .selectFrom('audits')
      .select('id')
      .where('id', '=', auditId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst();
    if (!audit) return null;
    await acquireProjectLock(trx, scope.projectId);
    const page = await trx
      .selectFrom('source_pages')
      .selectAll()
      .where('id', '=', pageId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (!page) return null;
    const now = new Date();
    if (
      lease &&
      (page.inspection_state !== 'queued' ||
        page.claim_expires_at?.getTime() !== lease.getTime() ||
        lease <= now)
    )
      return null;
    if (
      !lease &&
      page.inspection_state === 'queued' &&
      page.claim_expires_at &&
      page.claim_expires_at > now
    )
      return null;
    const id = randomUUID();
    await trx
      .insertInto('source_page_snapshots')
      .values({
        id,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        source_page_id: pageId,
        audit_id: auditId,
        requested_url: fetch.requestedUrl,
        final_url: fetch.finalUrl ?? '',
        status_code: fetch.status ?? null,
        content_type: fetch.type ?? null,
        charset: fetch.charset ?? null,
        body_bytes: fetch.bytes ?? 0,
        redirect_chain: fetch.redirects?.length ? JSON.stringify(fetch.redirects) : null,
        redacted_headers: fetch.headers ? JSON.stringify(fetch.headers) : null,
        robots_state: fetch.robots ?? null,
        outcome: fetch.outcome,
        outcome_reason: fetch.reason ?? null,
        content_hash: extracted?.content_hash ?? null,
        page_facts: extracted ? JSON.stringify(extracted.facts) : null,
        evidence_passages: assessment ? JSON.stringify(assessment.passages) : null,
        extracted_chars: extracted?.extracted_chars ?? 0,
        extractor_version: policy.source_pages.extractor_version,
        inspector_version: policy.source_pages.inspector_version,
        fetched_at: now,
        created_at: now,
      })
      .execute();
    if (assessment?.presences.length)
      await trx
        .insertInto('source_page_entity_presences')
        .values(
          assessment.presences.map((presence) => ({
            ...presence,
            id: randomUUID(),
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            source_page_id: pageId,
            snapshot_id: id,
            roster_version: roster,
            passage_refs: JSON.stringify(presence.passage_refs),
            detector_version: policy.source_pages.presence_version,
            created_at: now,
          })),
        )
        .execute();
    const replaceFormat =
      assessment &&
      assessment.format !== 'unresolved' &&
      rank(assessment.method) <= rank(page.page_format_method);
    await trx
      .updateTable('source_pages')
      .set({
        inspection_state: fetch.outcome,
        inspection_reason: fetch.reason ?? null,
        claim_expires_at: null,
        latest_snapshot_id: id,
        updated_at: now,
        ...(fetch.outcome === 'inspected'
          ? {
              last_inspected_at: now,
              content_hash: extracted?.content_hash ?? null,
              inspector_version: policy.source_pages.inspector_version,
            }
          : {}),
        ...(replaceFormat
          ? {
              page_format: assessment.format,
              page_format_method: assessment.method,
              page_format_version: policy.source_pages.format_version,
            }
          : {}),
      })
      .where('id', '=', pageId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    return id;
  });
}
