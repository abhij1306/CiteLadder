/**
 * The `page_fetch` analytics task (content optimization phase 2, CO12). The
 * chat and this task were committed together before any network I/O. The
 * executor fetches the page once through Site Health's fetcher (robots gate,
 * hard exclusions, the operator stop list, host pacing) and reads it outside
 * any transaction. The worker's fenced terminal transaction then records the
 * outcome: a fetched page becomes the chat's page document and queues its
 * first turn; any other outcome leaves a chat notice and no turn, so no model
 * is called (B73).
 */
import { randomUUID } from 'node:crypto';

import { agentBindings } from '../agent/bindings.ts';
import type { Chat } from '../agent/contracts.ts';
import { appendMessage, touchChat } from '../agent/messages.ts';
import { createFetchedDocument } from '../agent/outputs.ts';
import type { AgentStore } from '../agent/store.ts';
import { normalizeDomain } from '../analysis/domains.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { taskProject, type Executor } from '../queue/executor.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import type { FetchedPage, WebsiteFetcher } from '../safe-fetch.ts';
import { isBotBlock, SitePageFetcher, siteFetchSettings } from '../site-health/page-fetch.ts';
import { hardExcluded } from '../site-health/url-admission.ts';
import { pageLocalChecks, type PageCheck } from './checks.ts';
import { pageFetchPayloadSchema, type PageFetchPayload } from './keys.ts';
import { readPageDocument, type PageReading } from './markdown.ts';
import { insertSuggestion, type PageField, type RevisionText } from './suggestions.ts';

const p = policy.content_optimization.page_fetch;
const BLOCKED: ReadonlySet<string> = new Set(p.blocked_robots_codes);
const UNSUPPORTED: ReadonlySet<string> = new Set(p.unsupported_codes);
const BODYLESS: ReadonlySet<number> = new Set(
  policy.site_health.page_analysis.acquisition.bodyless_status_codes,
);
const BOT_BLOCKED = policy.site_health.page_analysis.acquisition.error_codes.bot_blocked;

type Outcome = (typeof p.outcomes)[number];
type Document = Extract<PageReading, { kind: 'document' }>;
/** How one fetch ended: only a fetched page carries a document and its checks. */
export type FetchResult =
  | {
      outcome: 'fetched';
      page: FetchedPage;
      document: Document;
      pageKind: string;
      checks: PageCheck[];
      fetchedAt: Date;
    }
  | {
      outcome: Exclude<Outcome, 'fetched'>;
      reason: string;
      page: FetchedPage | null;
      fetchedAt: Date;
    };
type Failure = Extract<FetchResult, { outcome: Exclude<Outcome, 'fetched'> }>;

/** The page's site with or without `www.`: a redirect off it is not this page. */
const site = (url: URL) => normalizeDomain(url.hostname);

/** A failed request's outcome from its Site Health acquisition code. */
function failedFetch(code: string, fetchedAt: Date): Failure {
  if (BLOCKED.has(code)) return { outcome: 'blocked_robots', reason: code, page: null, fetchedAt };
  if (UNSUPPORTED.has(code)) return { outcome: 'unsupported', reason: code, page: null, fetchedAt };
  return { outcome: 'failed', reason: code, page: null, fetchedAt };
}

/** A response that is not a readable page, or null when it is one. */
function refusedResponse(page: FetchedPage, fetchedAt: Date): Failure | null {
  if (isBotBlock(page)) return { outcome: 'failed', reason: BOT_BLOCKED, page, fetchedAt };
  if (page.status < 200 || page.status >= 300)
    return { outcome: 'http_error', reason: `http_${page.status}`, page, fetchedAt };
  if (BODYLESS.has(page.status))
    return { outcome: 'unsupported', reason: 'no_content', page, fetchedAt };
  return null;
}

/** One fetch of the page and what it reads as. Network I/O only; nothing is written here. */
export async function fetchPage(
  db: Database,
  url: string,
  fetcher?: WebsiteFetcher,
): Promise<FetchResult> {
  const base = siteFetchSettings();
  const pageFetcher = new SitePageFetcher(db, fetcher, {
    ...base,
    acquisition: { ...base.acquisition, timeout: p.timeout_seconds },
    maxWireBytes: p.max_wire_bytes,
    maxDecodedBytes: p.max_decoded_bytes,
  });
  const fetchedAt = new Date();
  const home = site(new URL(url));
  const result = await pageFetcher.fetch(url, {
    admit: (hop) => !hardExcluded(hop) && site(hop) === home,
  });
  if (!result.ok) return failedFetch(result.code, fetchedAt);
  const { page } = result;
  const refused = refusedResponse(page, fetchedAt);
  if (refused) return refused;
  const reading = readPageDocument(page.body, { finalUrl: page.url, charset: page.charset });
  if (reading.kind === 'no_content')
    return { outcome: 'unsupported', reason: 'no_content', page, fetchedAt };
  if (reading.kind === 'too_long')
    return { outcome: 'unsupported', reason: 'document_too_long', page, fetchedAt };
  const { pageKind, checks } = await pageLocalChecks(page, {
    at: fetchedAt,
    latencyMs: result.latencyMs,
  });
  return { outcome: 'fetched', page, document: reading, pageKind, checks, fetchedAt };
}

const REASONS: Record<string, string> = {
  unsupported_content_type: 'it is not an HTML page',
  response_too_large: 'it is larger than CiteLadder fetches',
  no_content: 'it has no main content to read',
  document_too_long: 'it is longer than one editable document',
};
/** Why the page could not be read, in words the person can act on. No model was called. */
function fetchNotice(url: string, result: Pick<Failure, 'outcome' | 'reason' | 'page'>) {
  const end = 'Start a new chat on the page once it can be read.';
  switch (result.outcome) {
    case 'blocked_robots':
      return `I couldn’t read ${url}: the site’s robots.txt or access rules don’t allow CiteLadder’s crawler to fetch it. ${end}`;
    case 'http_error':
      return `I couldn’t read ${url}: the site answered with HTTP ${result.page?.status ?? 'an error'}. Check that the page is live. ${end}`;
    case 'unsupported':
      return `I couldn’t use ${url} as a page to edit: ${REASONS[result.reason] ?? 'its response could not be read'}. ${end}`;
    case 'failed':
      return `I couldn’t read ${url} because the fetch failed. ${end}`;
    default: {
      const _exhaustive: never = result.outcome;
      return _exhaustive;
    }
  }
}

/** The raw body kept on the snapshot, cut at the configured size. */
function keptBody(page: FetchedPage | null) {
  if (!page) return { body: null, truncated: false };
  const truncated = page.body.length > p.snapshot_body_max_bytes;
  return {
    body: truncated ? page.body.subarray(0, p.snapshot_body_max_bytes) : page.body,
    truncated,
  };
}

/** Appends the fetch's one snapshot: insert-only evidence of what the site answered. */
async function insertSnapshot(
  db: Database,
  task: { workspaceId: string; projectId: string; payload: PageFetchPayload },
  result: FetchResult,
) {
  const { body, truncated } = keptBody(result.page);
  const fetched = result.outcome === 'fetched' ? result : null;
  const row = await db
    .insertInto('page_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: task.workspaceId,
      project_id: task.projectId,
      site_url_id: task.payload.site_url_id,
      chat_id: task.payload.chat_id,
      action_id: task.payload.action_id,
      requested_url: task.payload.url,
      final_url: result.page?.url ?? null,
      fetched_at: result.fetchedAt,
      http_status: result.page?.status ?? null,
      outcome: result.outcome,
      outcome_reason: result.outcome === 'fetched' ? null : result.reason,
      content_type: result.page?.contentType ?? null,
      charset: result.page?.charset ?? null,
      body,
      body_truncated: truncated,
      extractor_version: p.extractor_version,
      rules_version: fetched ? policy.site_health.versions.rules : null,
      page_kind: fetched?.pageKind ?? null,
      evaluations: fetched ? JSON.stringify(fetched.checks) : null,
      created_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The chat the fetch belongs to, locked; null once it was archived. */
async function liveChat(db: Database, task: QueueTask, projectId: string, chatId: string) {
  const chat = await db
    .selectFrom('agent_chats')
    .selectAll()
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', projectId)
    .where('id', '=', chatId)
    .forUpdate()
    .executeTakeFirst();
  return chat && !chat.archived_at ? chat : null;
}

/** The fetch's failure as the chat's reply to its first message, with no turn. */
async function postNotice(db: Database, chat: Chat, payload: PageFetchPayload, notice: string) {
  await appendMessage(db, await touchChat(db, chat.workspace_id, chat.id), {
    role: 'agent',
    replyTo: payload.user_message_id,
    content: notice,
  });
}

/**
 * Records one fetch in the caller's transaction: the snapshot, then either the
 * page document and its first turn, or the notice. A chat archived meanwhile
 * keeps only the snapshot.
 */
async function recordFetch(db: Database, store: AgentStore, task: QueueTask, result: FetchResult) {
  const projectId = await taskProject(db, task);
  const payload = pageFetchPayloadSchema.parse(task.payload);
  const fetch = { taskId: task.id, workspaceId: task.workspace_id, projectId, payload };
  const snapshotId = await insertSnapshot(db, fetch, result);
  const chat = await liveChat(db, task, projectId, payload.chat_id);
  if (!chat) return;
  if (result.outcome !== 'fetched') {
    await postNotice(db, chat, payload, fetchNotice(payload.url, result));
    return;
  }
  const workflow = store.dependencies.catalog.workflows?.byId.get(payload.workflow_id);
  const skill = workflow ? store.dependencies.catalog.skills.get(workflow.skill_id) : undefined;
  if (!skill) throw new TypeError(`Page workflow ${payload.workflow_id} has no skill`);
  const document = await createFetchedDocument(db, chat, {
    kind: skill.outputKind,
    skillId: skill.id,
    snapshotId,
    title: result.document.title,
    body: result.document.body,
    fields: result.document.fields,
  });
  await siteHealthSuggestions(db, chat, {
    outputId: document.output.id,
    revision: { ...document.revision, fields: result.document.fields },
    snapshotId,
    checks: result.checks,
  });
  await store.queueFetchedTurn(db, fetch, snapshotId);
}

const SUGGESTED = policy.content_optimization.suggestions;
const FIELD_RULES: Readonly<Record<string, PageField>> = SUGGESTED.site_health_field_rules;
const FAILING: ReadonlySet<string> = new Set(policy.site_health.reads.failing_outcomes);
const RULES = new Map(policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule]));

/**
 * The fetch's page-local Site Health findings that a field fixes (a missing
 * title or meta description) become `site_health` suggestions on revision 1,
 * in the same transaction as the checks that found them, so the first turn
 * already sees them and can write their text. They are advice until then:
 * Site Health judges, it does not write copy. Every other finding stays in the
 * SEO tab only (CO11).
 */
async function siteHealthSuggestions(
  db: Database,
  chat: Chat,
  document: {
    outputId: string;
    revision: RevisionText;
    snapshotId: string;
    checks: readonly PageCheck[];
  },
) {
  for (const check of document.checks) {
    const field = FIELD_RULES[check.rule_id];
    if (!field || !check.display_applicability || !FAILING.has(check.outcome)) continue;
    const rule = RULES.get(check.rule_id);
    await insertSuggestion(
      db,
      {
        workspaceId: chat.workspace_id,
        projectId: chat.project_id,
        outputId: document.outputId,
        revision: document.revision,
        by: { actor: 'system' },
      },
      {
        id: randomUUID(),
        anchor: { kind: 'field', field },
        dependsOn: [],
        replacement: null,
        needsInput: null,
        ruleId: check.rule_id,
        rationale: rule ? `${rule.display_label}. ${rule.remediation}` : check.rule_id,
        source: 'site_health',
        snapshotId: document.snapshotId,
        ruleVersion: check.rule_version,
      },
    );
  }
}

type Dependencies = {
  fetcher?: WebsiteFetcher;
  /** The Agent store that queues the turn; the process's own bindings by default. */
  store?: (db: Database) => Promise<AgentStore>;
};
const processStore = async (db: Database) => (await agentBindings(db)).store;

/** The executor: fetch and read outside any transaction, record in the worker's terminal one. */
export function pageFetchTask({ fetcher, store = processStore }: Dependencies = {}): Executor {
  return async (task, { db, checkCancelled }) => {
    await taskProject(db, task);
    const payload = pageFetchPayloadSchema.parse(task.payload);
    const agent = await store(db);
    await checkCancelled('page fetch');
    const result = await fetchPage(db, payload.url, fetcher);
    await checkCancelled('page document');
    return { error: null, persist: (trx) => recordFetch(trx, agent, task, result) };
  };
}

/**
 * A task that failed to record its fetch still answers the chat: a `failed`
 * snapshot and its notice, unless a snapshot was recorded after all.
 */
export function compensatePageFetch(store = processStore) {
  return async (db: Database, task: QueueTask) => {
    const projectId = await taskProject(db, task);
    const payload = pageFetchPayloadSchema.parse(task.payload);
    const agent = await store(db);
    await db.transaction().execute(async (trx) => {
      const recorded = await trx
        .selectFrom('page_snapshots')
        .select('id')
        .where('workspace_id', '=', task.workspace_id)
        .where('project_id', '=', projectId)
        .where('chat_id', '=', payload.chat_id)
        .where('requested_url', '=', payload.url)
        .executeTakeFirst();
      if (recorded) return;
      await recordFetch(trx, agent, task, {
        outcome: 'failed',
        reason: 'task_failed',
        page: null,
        fetchedAt: new Date(),
      });
    });
  };
}
