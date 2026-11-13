/**
 * Analyze a page (CO6, content optimization phase 2 PR 4): one of the latest
 * crawl's content pages, a topic with prompts and some of its prompts become
 * the page's Action (created or reused through the Agent's target attachment)
 * and a new `optimize_page` chat on it. The chat is the same page chat the
 * Agent route starts: its admission and page fetch, in one
 * transaction with the Action, so a refused start leaves no Action behind.
 */
import type { z } from 'zod';
import type { actionAnalyzeRequestSchema } from '@citeladder/contracts/actions';

import type { Scope } from '../agent/contracts.ts';
import type { AgentStore } from '../agent/store.ts';
import { policy } from '../config.ts';
import { contentPageAnalyses } from '../content-gaps/load.ts';
import type { Database } from '../db/database.ts';
import { containsPattern } from '../db/like.ts';
import { ApiError } from '../errors.ts';
import { attachOrCreateAction } from '../opportunities/actions.ts';
import { ActionTargetError } from '../opportunities/targets/registry.ts';
import { resolveCrawlId } from '../opportunities/sources.ts';
import { topicWithPrompts } from '../prompts/topics.ts';

const p = policy.content_optimization.analyze_page;
type ProjectScope = Pick<Scope, 'workspaceId' | 'projectId'>;
type AnalyzeRequest = z.output<typeof actionAnalyzeRequestSchema>;

const NO_CRAWL = 'Run a crawl first. Analyze a page reads the content pages of your latest crawl.';
const NOT_CONTENT = 'Choose one of the content pages in your latest crawl.';

/**
 * The latest crawl's content pages whose address or title contains `query`,
 * in address order, at most the configured number; `truncated` says more match.
 */
export async function listAnalyzablePages(db: Database, scope: ProjectScope, query: string | null) {
  const crawlId = await resolveCrawlId(db, scope);
  if (crawlId === null) return { crawl_id: null, items: [], truncated: false };
  let pages = contentPageAnalyses(db, scope, crawlId).select([
    'url.id',
    'url.normalized_url',
    'url.latest_title',
    'analysis.page_kind',
  ]);
  const needle = query?.trim();
  if (needle) {
    const pattern = containsPattern(needle);
    pages = pages.where((eb) =>
      eb.or([eb('url.normalized_url', 'ilike', pattern), eb('url.latest_title', 'ilike', pattern)]),
    );
  }
  const rows = await pages
    .orderBy('url.normalized_url')
    .orderBy('url.id')
    .limit(p.page_list_max + 1)
    .execute();
  return {
    crawl_id: crawlId,
    items: rows.slice(0, p.page_list_max).map((row) => ({
      site_url_id: row.id,
      url: row.normalized_url,
      title: row.latest_title,
      page_kind: row.page_kind,
    })),
    truncated: rows.length > p.page_list_max,
  };
}

/** The chosen page as one of the latest crawl's content pages, or a 422. */
async function contentPage(db: Database, scope: ProjectScope, siteUrlId: string) {
  const crawlId = await resolveCrawlId(db, scope);
  if (crawlId === null) throw new ApiError(422, NO_CRAWL);
  const page = await contentPageAnalyses(db, scope, crawlId)
    .select(['url.id', 'url.normalized_url'])
    .where('url.id', '=', siteUrlId)
    .executeTakeFirst();
  if (!page) throw new ApiError(422, NOT_CONTENT);
  return { siteUrlId: page.id, url: page.normalized_url };
}

/** The chosen topic, which must hold prompts, and only prompts it holds. */
async function chosenTopic(db: Database, scope: ProjectScope, input: AnalyzeRequest) {
  const topic = await topicWithPrompts(db, scope, input.topic_id);
  if (!topic) throw new ApiError(422, 'Choose one of your topics.');
  if (topic.prompts.length === 0)
    throw new ApiError(422, 'This topic has no prompts yet. Choose a topic with prompts.');
  const held = new Set(topic.prompts.map((prompt) => prompt.id));
  if (!input.prompt_ids.every((id) => held.has(id)))
    throw new ApiError(422, 'Choose prompts from the topic you picked.');
  return topic;
}

/**
 * Starts the page's analysis: validates the page, topic and prompts, then
 * creates the chat with the Action attached in the same transaction. A
 * repeat for the same page reuses its Action and starts a new chat, since
 * each chat reads the live page afresh; a retried request (same
 * Idempotency-Key and body) returns the chat it already started.
 */
export async function analyzePage(
  db: Database,
  store: AgentStore,
  scope: Scope,
  input: AnalyzeRequest,
  key: string,
) {
  const page = await contentPage(db, scope, input.site_url_id);
  const topic = await chosenTopic(db, scope, input);
  const created = await store.create(
    scope,
    {
      message: p.message.replaceAll('{topic}', topic.name),
      workflowId: p.workflow_id,
      refs: {
        target_url: page.url,
        target_site_url_id: page.siteUrlId,
        prompt_reference: { topic_id: topic.id, prompt_ids: input.prompt_ids },
      },
      key,
    },
    async (trx) => {
      try {
        const action = await attachOrCreateAction(trx, scope, 'page', page.url, scope.userId);
        return action.id;
      } catch (error) {
        if (error instanceof ActionTargetError)
          throw new ApiError(422, "This page is outside your project's domains.");
        throw error;
      }
    },
  );
  const chat = await db
    .selectFrom('agent_chats')
    .select('action_id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', created.chatId)
    .executeTakeFirstOrThrow();
  // Only a replay of an unrelated chat request under the same key lacks one.
  if (!chat.action_id) throw new ApiError(409, 'This Idempotency-Key was used for another request');
  return { actionId: chat.action_id, chatId: created.chatId, run: created.run };
}
