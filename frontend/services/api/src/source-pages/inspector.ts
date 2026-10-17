/** Bounded source acquisition, evidence publication, and the owed Opportunity handoff. */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { parseUuid } from '../http/uuid.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import {
  enqueueImplementationVerification,
  enqueueOpportunityRefresh,
} from '../opportunities/enqueue.ts';
import {
  TaskCancelledError,
  taskProject,
  payloadString,
  type Executor,
} from '../workers/executor.ts';
import { getLogger } from '../logging.ts';
import { FetchError, type FetchedPage, type WebsiteFetcher } from '../projects/safe-fetch.ts';
import { PageAcquirer, authorizeAcquisition } from '../web-evidence/acquisition.ts';
import { citationIdentity } from '../site-health/url-identity.ts';
import { claimPages, spendRedirect, type SourceScope } from './admission.ts';
import { assessPage } from './assessment.ts';
import { extractSourcePage } from './extract.ts';
import { recordInspection, type FetchOutcome } from './persistence.ts';
import { projectRoster } from './reading.ts';
import { syncCitedPages, syncPages, resolveCitation } from './sync.ts';
import { refreshDifferentiation } from './differentiation.ts';
import { fenceInspectionTask } from './task-fence.ts';

const p = policy.source_pages;
const logger = getLogger('app.workers.source_pages');
function auditId(task: QueueTask) {
  const id = parseUuid(payloadString(task, 'audit_id'));
  if (!id) throw new Error('Source-page inspection requires audit_id');
  return id;
}
async function auditScope(db: Database, task: QueueTask) {
  const projectId = await taskProject(db, task);
  const audit = await db
    .selectFrom('audits')
    .select(['id', 'configuration'])
    .where('id', '=', auditId(task))
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!audit) throw new Error('Source-page inspection audit is unavailable');
  return { scope: { workspaceId: task.workspace_id, projectId }, audit };
}
async function handoff(
  db: Database,
  scope: SourceScope,
  audit: string,
  maxAttempts: number,
  task?: QueueTask,
) {
  await db.transaction().execute(async (trx) => {
    await fenceInspectionTask(trx, task);
    const trigger = { ...scope, triggerKind: 'audit', triggerId: audit, maxAttempts };
    await enqueueOpportunityRefresh(trx, trigger);
    await enqueueImplementationVerification(trx, trigger);
  });
}
export async function compensateInspection(db: Database, task: QueueTask) {
  const { scope, audit } = await auditScope(db, task);
  await handoff(db, scope, audit.id, task.max_attempts);
}
function fetchedOutcome(url: string, result: FetchedPage): FetchOutcome {
  const ok = result.status >= 200 && result.status < 300;
  const readable = p.allowed_content_types.includes(
    result.contentType.split(';')[0]!.trim().toLowerCase(),
  );
  return {
    outcome: ok && readable ? 'inspected' : 'failed',
    requestedUrl: url,
    finalUrl: result.url,
    status: result.status,
    type: result.contentType,
    charset: result.charset,
    bytes: result.body.length,
    redirects: result.redirects,
    headers: result.headers,
    robots: 'allowed',
    reason: rejection(ok, readable),
  };
}
function rejection(ok: boolean, readable: boolean) {
  if (!ok) return 'status_rejected';
  return readable ? undefined : 'non_html';
}
function failedOutcome(url: string, error: unknown): FetchOutcome {
  const code = error instanceof FetchError ? error.code : 'transport_error';
  if (code === 'robots_disallowed') {
    return { outcome: 'blocked', requestedUrl: url, robots: 'disallowed', reason: code };
  }
  return {
    outcome: 'failed',
    requestedUrl: url,
    robots: code === 'robots_unavailable' ? 'unavailable' : undefined,
    reason: code === 'content_type' ? 'non_html' : code.slice(0, 48),
  };
}
export function sourcePageInspector(fetcher?: WebsiteFetcher): Executor {
  return async (task, context) => {
    const { db, checkCancelled } = context;
    const { scope, audit } = await auditScope(db, task);
    const configuration = record(audit.configuration);
    const roster = projectRoster(configuration);
    const acquirer = new PageAcquirer((url) => authorizeAcquisition(db, url), fetcher);
    const options = {
      maxBytes: p.max_wire_bytes,
      maxDecodedBytes: p.max_decoded_bytes,
      timeoutSeconds: p.hop_timeout_seconds,
      redirects: p.max_redirects,
      contentTypes: p.allowed_content_types,
    };
    await checkCancelled('source-page synchronization');
    const tokens = await syncPages(db, scope, audit.id, roster, new Date(), task);
    const prefetched = new Map<string, FetchedPage>();
    for (const token of tokens) {
      await checkCancelled('redirect admission');
      const spent = await spendRedirect(db, scope, token, new Date(), task);
      if (spent === 'exhausted') break;
      if (spent === 'duplicate') continue;
      let result: FetchedPage;
      try {
        result = await acquirer.fetch(token, options);
      } catch {
        continue;
      }
      const identity = citationIdentity(result.url);
      if (!identity) continue;
      await checkCancelled('citation resolution');
      await resolveCitation(db, scope, audit.id, token, result.url, task);
      prefetched.set(identity.hash, result);
    }
    if (prefetched.size) {
      await checkCancelled('resolved source synchronization');
      await syncCitedPages(db, scope, audit.id, [...prefetched.keys()], new Date(), task);
    }
    const inspected: string[] = [];
    const persist = async (
      id: string,
      url: string,
      lease: Date | null,
      result: FetchedPage | FetchOutcome,
    ) => {
      await checkCancelled('source-page publication');
      // One page's failure must not discard its siblings' readings; its claim
      // lease lapses and a later inspection retries it.
      try {
        const fetched = 'body' in result ? fetchedOutcome(url, result) : result;
        const extracted =
          fetched.outcome === 'inspected' && 'body' in result
            ? extractSourcePage(result.body, result.charset)
            : undefined;
        const assessment = extracted ? assessPage(extracted, configuration) : undefined;
        const recorded = await recordInspection(db, task, {
          scope,
          pageId: id,
          lease,
          fetch: fetched,
          auditId: audit.id,
          roster,
          extracted,
          assessment,
        });
        if (recorded) inspected.push(id);
      } catch (error) {
        if (error instanceof TaskCancelledError) throw error;
        logger.exception('source-page persistence failed', error, { source_page_id: id });
      }
    };
    for (const [hash, result] of prefetched) {
      const page = await db
        .selectFrom('source_pages')
        .select(['id', 'canonical_url'])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('url_hash', '=', hash)
        .executeTakeFirst();
      if (page) await persist(page.id, page.canonical_url, null, result);
    }
    await checkCancelled('source-page admission');
    const claims = await claimPages(db, scope, new Date(), task);
    let next = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(p.fetch_concurrency, claims.length) }, async () => {
        while (next < claims.length) {
          const claim = claims[next++]!;
          await checkCancelled('source-page acquisition');
          let result: FetchedPage | FetchOutcome;
          try {
            result = await acquirer.fetch(claim.url, options);
          } catch (error) {
            result = failedOutcome(claim.url, error);
          }
          await persist(claim.id, claim.url, claim.lease, result);
        }
      }),
    );
    const failed = workers.find((worker) => worker.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await checkCancelled('content differentiation');
    await refreshDifferentiation(db, scope, audit.id, inspected, task);
    await checkCancelled('Opportunity handoff');
    await handoff(db, scope, audit.id, task.max_attempts, task);
  };
}
