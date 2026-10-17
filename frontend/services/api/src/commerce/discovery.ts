/** Discovery admission freezes targets; publication fences the claim after bounded network work. */
import { randomUUID } from 'node:crypto';
import { commerceTargetSchema, commerceTargetsSchema } from '@citeladder/contracts/commerce-suite';
import { z } from 'zod';
import { dailyWorkspaceLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { loadWorkerSettings, policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { meterFor } from '../models/metering.ts';
import { jsonObject } from '../db/json.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { taskProject, TerminalExecutorError, type Executor } from '../workers/executor.ts';
import { PageAcquirer, authorizeAcquisition } from '../web-evidence/acquisition.ts';
import { fetchWebsite, type WebsiteFetcher } from '../projects/safe-fetch.ts';
import { commerceMissing, type CommerceScope } from './reads.ts';
import { lockCatalog } from './catalog-store.ts';
import {
  competitorSearch,
  type CompetitorSearch,
  type SearchOutcome,
} from './discovery-provider.ts';
import {
  contextText,
  discoveryQuery,
  exclusion,
  ownedHosts,
  prepareResults,
  searchableName,
  verifyPage,
} from './discovery-validation.ts';

const p = policy.commerce.discovery;
export const discoveryInput = z.object({
  targets: commerceTargetsSchema,
});
const payloadSchema = z.object({
  target: commerceTargetSchema,
  target_context: z.record(z.string(), z.unknown()),
  locale: z.string().default(''),
});

async function targetContext(
  db: Database,
  scope: CommerceScope,
  target: z.infer<typeof commerceTargetSchema>,
  executing = false,
) {
  const table = target.kind === 'product' ? 'commerce_products' : 'commerce_categories';
  const row = await db
    .selectFrom(table)
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', target.id)
    .executeTakeFirst();
  if (!row) {
    if (executing) throw new TerminalExecutorError(p.target_missing_error);
    commerceMissing('Commerce target not found');
  }
  return {
    name: row.name,
    ...('attributes' in row
      ? {
          attributes: jsonObject(row.attributes, 'product attributes'),
          price: row.price === null ? null : Number(row.price),
          currency: row.currency,
        }
      : {}),
  };
}

export function enqueueDiscoveries(
  db: Database,
  scope: CommerceScope,
  input: z.infer<typeof discoveryInput>,
) {
  return db.transaction().execute(async (trx) => {
    await lockCatalog(trx, scope);
    const project = await trx
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', scope.projectId)
      .where('workspace_id', '=', scope.workspaceId)
      .executeTakeFirst();
    if (!project) commerceMissing('Project not found');
    const runId = randomUUID(),
      locale = [project.language_code, project.country_code].filter(Boolean).join('-');
    const targetKey = (target: z.infer<typeof commerceTargetSchema>) =>
      `${target.kind}:${target.id.toLowerCase()}`;
    const targets = new Map(input.targets.map((target) => [targetKey(target), target]));
    // Each target spends platform research-provider calls and outbound fetches.
    await enforceWorkspaceRequest(
      trx,
      scope.workspaceId,
      dailyWorkspaceLimit(
        'commerce.competitor_discovery',
        'commerce_discoveries_per_workspace_daily',
        targets.size,
      ),
    );
    const ids = new Map(
      await Promise.all(
        [...targets].map(async ([key, target]) => {
          const context = await targetContext(trx, scope, target);
          const id =
            (await enqueueTask(trx, {
              ...scope,
              kind: 'commerce_competitor_discovery',
              payload: { target, target_context: context, locale, run_id: runId },
              keyParts: [],
              idempotencyKey: `commerce:competitors:${runId}:${key}`,
              maxAttempts: loadWorkerSettings().taskMaxAttempts,
            })) ?? undefined;
          if (!id) throw new Error('Competitor discovery task was not persisted');
          return [key, id] as const;
        }),
      ),
    );
    return { task_ids: input.targets.map((target) => ids.get(targetKey(target))!) };
  });
}

type Prepared = ReturnType<typeof prepareResults>;
async function validate(
  db: Database,
  items: Prepared,
  kind: 'category' | 'product',
  owned: string[],
  fetcher?: WebsiteFetcher,
) {
  const boundedFetcher: WebsiteFetcher = (url, options) => {
    const timeout = AbortSignal.timeout(p.verify_timeout_seconds * 1000);
    return (fetcher ?? fetchWebsite)(url, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  };
  const acquirer = new PageAcquirer((url) => authorizeAcquisition(db, url), boundedFetcher);
  const spec = policy.site_health.settings;
  const setting = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], process.env));
  const candidates = items.filter((item) => !item.validation_outcome && item.canonical);
  let next = 0;
  const verified = new Set<string>();
  const attempted = new Set<string>();
  await Promise.all(
    Array.from({ length: Math.min(p.verify_concurrency, candidates.length) }, async () => {
      // Each consumer verifies one page at a time; parallelizing the loop
      // would exceed the configured acquisition concurrency. Fetching stops
      // once enough pages verified to fill the accept limit.
      while (next < candidates.length && verified.size < p.result_limit) {
        const item = candidates[next++]!;
        attempted.add(item.canonical!);
        try {
          const page = await acquirer.fetch(item.canonical!, {
            maxBytes: setting('max_response_wire_bytes'),
            maxDecodedBytes: setting('max_response_decoded_bytes'),
            timeoutSeconds: p.verify_timeout_seconds,
            redirects: setting('max_redirects'),
            contentTypes: ['text/html'],
            signal: AbortSignal.timeout(p.verify_timeout_seconds * 1000),
            admit: (url) => {
              if (exclusion(url.href, '', owned)) throw new Error('Excluded destination');
            },
          });
          if (verifyPage(page, kind, owned)) verified.add(item.canonical!);
        } catch {
          /* A rejected or unavailable page never fails its siblings. */
        }
      }
    }),
  );
  let accepted = 0;
  return items.map((item) => {
    let verdict = item.validation_outcome;
    if (!verdict) {
      if (!attempted.has(item.canonical!)) verdict = 'excluded_limit';
      else if (!verified.has(item.canonical!)) verdict = 'excluded_unavailable';
      else verdict = accepted++ < p.result_limit ? 'accepted' : 'excluded_limit';
    }
    return { ...item, validation_outcome: verdict };
  });
}

async function publish(
  db: Database,
  task: QueueTask,
  projectId: string,
  payload: z.infer<typeof payloadSchema>,
  query: string,
  outcome: SearchOutcome,
  items: Prepared,
) {
  const trx = db;
  await lockCatalog(trx, { workspaceId: task.workspace_id, projectId });
  await targetContext(trx, { workspaceId: task.workspace_id, projectId }, payload.target, true);
  const currentOwned = await ownedHosts(trx, { workspaceId: task.workspace_id, projectId });
  items = items.map((item) => ({
    ...item,
    validation_outcome:
      item.validation_outcome === 'accepted' && item.canonical
        ? exclusion(item.canonical, item.title, currentOwned) || item.validation_outcome
        : item.validation_outcome,
  }));
  const attemptId = randomUUID(),
    now = new Date();
  await trx
    .insertInto('commerce_competitor_attempts')
    .values({
      id: attemptId,
      workspace_id: task.workspace_id,
      project_id: projectId,
      task_id: task.id,
      target_kind: payload.target.kind,
      target_id: payload.target.id,
      attempt_number: task.attempt_count + 1,
      query,
      locale: payload.locale,
      status: outcome.status,
      error_code: outcome.errorCode,
      provider_version: outcome.providerVersion ?? p.provider_version,
      validator_version: p.validator_version,
      created_at: now,
      result_payload: JSON.stringify(
        items.map((item) => ({
          url: item.url.slice(0, 2048),
          title: item.title.slice(0, 512),
          content: item.content.slice(0, p.snippet_chars),
          validation_outcome: item.validation_outcome,
          source_id: item.source_id,
          processing_version: item.processing_version,
          provider: item.provider,
        })),
      ),
    })
    .execute();
  const survivors = items.filter(
    (item) => item.validation_outcome === 'accepted' && item.canonical,
  );
  if (survivors.length)
    await trx
      .insertInto('commerce_competitor_candidates')
      .values(
        survivors.map((item) => ({
          id: randomUUID(),
          workspace_id: task.workspace_id,
          project_id: projectId,
          attempt_id: attemptId,
          target_kind: payload.target.kind,
          target_id: payload.target.id,
          canonical_url: item.canonical!,
          product_name: item.title.slice(0, 512),
          brand_name: '',
          evidence: JSON.stringify({
            search_excerpt: item.content.slice(0, p.snippet_chars),
            extractor_version: policy.site_health.versions.extractor,
            classifier_version: policy.site_health.page_analysis.classification.version,
            source_id: item.source_id,
            processing_version: item.processing_version,
            provider: item.provider,
          }),
          source_kind: 'provider',
          state: 'pending',
          decision_at: null,
          created_at: now,
        })),
      )
      .onConflict((conflict) => conflict.constraint('uq_commerce_competitor_candidate').doNothing())
      .execute();
}

export function competitorDiscovery(
  options: { search?: CompetitorSearch; fetcher?: WebsiteFetcher } = {},
): Executor {
  return async (task, { db, checkCancelled }) => {
    const projectId = await taskProject(db, task),
      payload = payloadSchema.parse(task.payload);
    await targetContext(db, { workspaceId: task.workspace_id, projectId }, payload.target, true);
    const context = payload.target_context;
    if (!searchableName(contextText(context.name)))
      throw new TerminalExecutorError('unusable_target', 'Commerce target name is not searchable');
    const query = discoveryQuery(payload.target, context);
    const owned = await ownedHosts(db, { workspaceId: task.workspace_id, projectId });
    await checkCancelled('competitor search');
    const outcome = await (options.search ?? competitorSearch())(
      query,
      payload.locale,
      meterFor(db, task.workspace_id),
    );
    await checkCancelled('competitor verification');
    const items = await validate(
      db,
      prepareResults(outcome.results, owned),
      payload.target.kind,
      owned,
      options.fetcher,
    );
    let error: Error | null = null;
    if (outcome.retry) error = new Error('Competitor discovery provider failed');
    else if (outcome.status === 'unavailable') error = new TerminalExecutorError(outcome.errorCode);
    return {
      error,
      persist: (trx) => publish(trx, task, projectId, payload, query, outcome, items),
    };
  };
}
