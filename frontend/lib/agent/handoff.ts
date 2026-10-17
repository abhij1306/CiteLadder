/**
 * Evidence-screen handoffs into the Agent.
 *
 * **Work on this** opens New chat attached to an Action. **Ask agent** opens
 * New chat with typed evidence references and an optional prefilled question.
 * The URL carries identifiers only: the server resolves and authorizes each
 * one when the chat is created, so a tampered or stale id fails there, never
 * here. Parsing drops anything malformed rather than guessing.
 */
import type { AgentContextRefs } from '@/lib/api/agent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PARAM = {
  action: 'action_id',
  opportunity: 'opportunity_id',
  demandSignal: 'demand_signal_id',
  siteUrl: 'target_site_url_id',
  targetUrl: 'target_url',
  dataset: 'si_dataset_id',
  rows: 'si_row_id',
  prompt: 'prompt',
  skill: 'skill',
  workflow: 'workflow',
  issueCrawl: 'issue_crawl_id',
  issueGroup: 'issue_group_id',
  issuePage: 'issue_page_id',
  factsCrawl: 'facts_crawl_id',
  output: 'output_id',
  revision: 'revision_id',
} as const;

export type AgentHandoff = {
  actionId?: string;
  context: AgentContextRefs;
  prompt?: string;
  skillId?: string;
  workflowId?: string;
};

export type HandoffInput = {
  actionId?: string | null;
  opportunityId?: string | null;
  demandSignalId?: string | null;
  siteUrlId?: string | null;
  targetUrl?: string | null;
  searchIntelligence?: { datasetId: string; rowIds: readonly string[] } | null;
  issueGroup?: { crawlId: string; groupId: string; siteUrlId?: string };
  siteFacts?: { crawlId: string };
  outputRevision?: { outputId: string; revisionId: string };
  prompt?: string | null;
  skillId?: string | null;
  workflowId?: string | null;
};

/** `/agent` with the typed references a new chat should start from. */
export function agentHandoffHref(input: HandoffInput): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
  };
  set(PARAM.action, input.actionId);
  set(PARAM.opportunity, input.opportunityId);
  set(PARAM.demandSignal, input.demandSignalId);
  set(PARAM.siteUrl, input.siteUrlId);
  set(PARAM.targetUrl, input.targetUrl);
  set(PARAM.issueCrawl, input.issueGroup?.crawlId);
  set(PARAM.issueGroup, input.issueGroup?.groupId);
  set(PARAM.issuePage, input.issueGroup?.siteUrlId);
  set(PARAM.factsCrawl, input.siteFacts?.crawlId);
  set(PARAM.output, input.outputRevision?.outputId);
  set(PARAM.revision, input.outputRevision?.revisionId);
  if (input.searchIntelligence && input.searchIntelligence.rowIds.length > 0) {
    params.set(PARAM.dataset, input.searchIntelligence.datasetId);
    for (const row of input.searchIntelligence.rowIds) params.append(PARAM.rows, row);
  }
  set(PARAM.prompt, input.prompt?.trim());
  set(PARAM.skill, input.skillId);
  set(PARAM.workflow, input.workflowId);
  const query = params.toString();
  return query ? `/agent?${query}` : '/agent';
}

/**
 * The same references as a typed handoff, for the global agent panel. The
 * caller's values come from persisted reads, and the server still resolves and
 * authorizes each one when the chat is created.
 */
export function agentHandoff(input: HandoffInput): AgentHandoff {
  const context = originContext(input);
  if (input.opportunityId) context.opportunity_id = input.opportunityId;
  if (input.demandSignalId) context.demand_signal_id = input.demandSignalId;
  if (input.siteUrlId) context.target_site_url_id = input.siteUrlId;
  if (input.targetUrl) context.target_url = input.targetUrl;
  if (input.searchIntelligence && input.searchIntelligence.rowIds.length > 0) {
    context.search_intelligence_reference = {
      dataset_id: input.searchIntelligence.datasetId,
      row_ids: [...new Set(input.searchIntelligence.rowIds)],
    };
  }
  return {
    actionId: input.actionId ?? undefined,
    context,
    prompt: input.prompt?.trim() || undefined,
    ...(input.skillId ? { skillId: input.skillId } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
  };
}

function uuidParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value && UUID.test(value) ? value : undefined;
}
function originContext(input: HandoffInput): AgentContextRefs {
  const context: AgentContextRefs = {};
  if (input.issueGroup)
    context.issue_group_reference = {
      crawl_id: input.issueGroup.crawlId,
      group_id: input.issueGroup.groupId,
      ...(input.issueGroup.siteUrlId ? { site_url_id: input.issueGroup.siteUrlId } : {}),
    };
  if (input.siteFacts) context.site_facts_reference = { crawl_id: input.siteFacts.crawlId };
  if (input.outputRevision)
    context.output_revision_reference = {
      output_id: input.outputRevision.outputId,
      revision_id: input.outputRevision.revisionId,
    };
  return context;
}
function parsedOriginContext(params: URLSearchParams): AgentContextRefs {
  const context: AgentContextRefs = {};
  const issueCrawl = uuidParam(params, PARAM.issueCrawl),
    issueGroup = uuidParam(params, PARAM.issueGroup),
    issuePage = uuidParam(params, PARAM.issuePage);
  if (issueCrawl && issueGroup)
    context.issue_group_reference = {
      crawl_id: issueCrawl,
      group_id: issueGroup,
      ...(issuePage ? { site_url_id: issuePage } : {}),
    };
  const factsCrawl = uuidParam(params, PARAM.factsCrawl);
  if (factsCrawl) context.site_facts_reference = { crawl_id: factsCrawl };
  const output = uuidParam(params, PARAM.output),
    revision = uuidParam(params, PARAM.revision);
  if (output && revision)
    context.output_revision_reference = { output_id: output, revision_id: revision };
  return context;
}

function httpUrlParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A skill or workflow id; the server catalog validates membership. */
function catalogIdParam(params: URLSearchParams, key: string) {
  const value = params.get(key);
  return value && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

/** The handoff a New chat URL carries, with malformed values dropped. */
export function parseAgentHandoff(params: URLSearchParams): AgentHandoff {
  const context = parsedOriginContext(params);
  const opportunity = uuidParam(params, PARAM.opportunity);
  if (opportunity) context.opportunity_id = opportunity;
  const signal = uuidParam(params, PARAM.demandSignal);
  if (signal) context.demand_signal_id = signal;
  const siteUrl = uuidParam(params, PARAM.siteUrl);
  if (siteUrl) context.target_site_url_id = siteUrl;
  const targetUrl = httpUrlParam(params, PARAM.targetUrl);
  if (targetUrl) context.target_url = targetUrl;
  const dataset = uuidParam(params, PARAM.dataset);
  const rows = [...new Set(params.getAll(PARAM.rows).filter((row) => UUID.test(row)))];
  if (dataset && rows.length > 0) {
    context.search_intelligence_reference = { dataset_id: dataset, row_ids: rows };
  }
  const prompt = params.get(PARAM.prompt)?.trim() || undefined;
  // The server catalog validates membership; preserve explicit skill selections.
  const skillId = catalogIdParam(params, PARAM.skill);
  const workflowId = catalogIdParam(params, PARAM.workflow);
  return {
    actionId: uuidParam(params, PARAM.action),
    context,
    prompt,
    ...(skillId ? { skillId } : {}),
    ...(workflowId ? { workflowId } : {}),
  };
}

/** Human labels for the references a composer shows as removable chips. */
export type ContextChip = { key: keyof AgentContextRefs; label: string };

export function contextChips(context: AgentContextRefs): ContextChip[] {
  const chips: ContextChip[] = [];
  if (context.issue_group_reference)
    chips.push({
      key: 'issue_group_reference',
      label: context.issue_group_reference.site_url_id
        ? 'Selected page issue'
        : 'Selected issue group',
    });
  if (context.site_facts_reference)
    chips.push({ key: 'site_facts_reference', label: 'Selected crawl robots policy' });
  if (context.output_revision_reference)
    chips.push({ key: 'output_revision_reference', label: 'Selected document revision' });
  if (context.target_url) chips.push({ key: 'target_url', label: context.target_url });
  else if (context.target_site_url_id)
    chips.push({ key: 'target_site_url_id', label: 'Selected page' });
  if (context.opportunity_id) chips.push({ key: 'opportunity_id', label: 'Recommendation' });
  if (context.demand_signal_id) chips.push({ key: 'demand_signal_id', label: 'Demand signal' });
  if (context.search_intelligence_reference) {
    const count = context.search_intelligence_reference.row_ids.length;
    chips.push({
      key: 'search_intelligence_reference',
      label: `${count} Search Intelligence ${count === 1 ? 'row' : 'rows'}`,
    });
  }
  return chips;
}

export function withoutContext(
  context: AgentContextRefs,
  key: keyof AgentContextRefs,
): AgentContextRefs {
  const next = { ...context };
  delete next[key];
  // A URL chip and its page id describe one target; removing either drops both.
  if (key === 'target_url' || key === 'target_site_url_id') {
    delete next.target_url;
    delete next.target_site_url_id;
  }
  return next;
}
