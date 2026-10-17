/** Agent context orchestrates existing persisted owners, never acquisition. */
import { agentContextRefsSchema } from '@citeladder/contracts/agent';
import { policy } from '../config.ts';
import { plainJson, record } from '../db/json.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { readBrandMemory } from '../projects/brand-profile.ts';
import { readDemandOrigin } from '../demand/reads.ts';
import { getOpportunity } from '../opportunities/reads.ts';
import { contentHandoff as siteHandoff } from '../site-health/reads/content-handoff.ts';
import { contentHandoff as searchHandoff } from '../search-intelligence/reads.ts';
import { comparableUrl, selectContentFragments } from '../site-health/reads/content-fragments.ts';
import { issueDetail } from '../site-health/reads/issues.ts';
import { crawlability } from '../mcp/evidence-site.ts';
import { McpInputError } from '../mcp/types.ts';
import { revisionRefs } from './outputs.ts';
import type { ContextReader } from './context.ts';
import { AgentError } from './contracts.ts';
import { z } from 'zod';

function owned(candidate: unknown, website: string) {
  if (typeof candidate !== 'string' || !candidate) return '';
  try {
    return new URL(candidate).hostname.toLowerCase() === new URL(website).hostname.toLowerCase()
      ? candidate
      : '';
  } catch {
    return '';
  }
}
type OriginDb = Parameters<ContextReader>[0];
type OriginScope = Parameters<ContextReader>[1];
type OriginRefs = z.infer<typeof agentContextRefsSchema>;
async function resolveTarget(db: OriginDb, scope: OriginScope, refs: OriginRefs) {
  if (!refs.target_site_url_id) return null;
  const target = await db
    .selectFrom('site_urls')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', refs.target_site_url_id)
    .executeTakeFirst();
  if (!target) throw new AgentError('agent_context_unavailable');
  return target;
}
async function resolveOpportunity(db: OriginDb, scope: OriginScope, refs: OriginRefs) {
  if (!refs.opportunity_id) return null;
  const opportunity = await getOpportunity(db, scope.workspaceId, refs.opportunity_id);
  if (opportunity && opportunity.project_id !== scope.projectId)
    throw new AgentError('agent_context_unavailable');
  return opportunity;
}
async function resolveIssueGroup(db: OriginDb, scope: OriginScope, refs: OriginRefs) {
  const groupRef = refs.issue_group_reference;
  if (!groupRef) return null;
  const crawl = await db
    .selectFrom('site_crawls')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', groupRef.crawl_id)
    .executeTakeFirst();
  if (!crawl) throw new AgentError('agent_context_unavailable');
  const detail = await issueDetail(
    db,
    scope.workspaceId,
    groupRef.crawl_id,
    groupRef.group_id,
    { limit: policy.agent_context.content_context_max_pages, cursor: null },
    groupRef.site_url_id,
  );
  if (groupRef.site_url_id && !detail.occurrences.length)
    throw new AgentError('agent_context_unavailable');
  return {
    ...detail,
    selected_site_url_id: groupRef.site_url_id ?? null,
    sample: {
      supplied_occurrences: detail.occurrences.length,
      total_occurrences: detail.occurrence_count,
      complete: !detail.next_cursor && !groupRef.site_url_id,
      label: 'bounded occurrence sample',
    },
  };
}
async function resolveOrigins(
  db: Parameters<ContextReader>[0],
  scope: Parameters<ContextReader>[1],
  refs: z.infer<typeof agentContextRefsSchema>,
) {
  const project = await db
    .selectFrom('projects')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw new AgentError('agent_context_unavailable');
  const target = await resolveTarget(db, scope, refs);
  const opportunity = await resolveOpportunity(db, scope, refs);
  const demand = refs.demand_signal_id
    ? await readDemandOrigin(db, scope, refs.demand_signal_id)
    : null;
  const site = refs.site_health_reference
    ? await siteHandoff(db, scope, refs.site_health_reference)
    : null;
  if (target && site && target.id !== site.site_url_id)
    throw new AgentError('agent_context_conflict');
  const search = refs.search_intelligence_reference
    ? await searchHandoff(
        db,
        { workspace: new WorkspaceScope(scope.workspaceId), projectId: scope.projectId },
        refs.search_intelligence_reference.dataset_id,
        refs.search_intelligence_reference.row_ids,
      )
    : null;
  const issueGroup = await resolveIssueGroup(db, scope, refs);
  const groupRef = refs.issue_group_reference;
  const siteFacts = refs.site_facts_reference
    ? await crawlability(
        { db, scope, origin: '' },
        { crawl_id: refs.site_facts_reference.crawl_id },
      )
    : null;
  const upstreamRef = refs.output_revision_reference;
  let upstream = null;
  if (upstreamRef) {
    const revision = await db
      .selectFrom('agent_output_revisions as r')
      .innerJoin('agent_outputs as o', (join) =>
        join
          .onRef('o.id', '=', 'r.output_id')
          .onRef('o.workspace_id', '=', 'r.workspace_id')
          .onRef('o.project_id', '=', 'r.project_id'),
      )
      .select(['r.id', 'r.output_id', 'r.title', 'r.body', 'r.phase', 'r.source_refs', 'r.number'])
      .where('r.workspace_id', '=', scope.workspaceId)
      .where('r.project_id', '=', scope.projectId)
      .where('r.id', '=', upstreamRef.revision_id)
      .where('o.id', '=', upstreamRef.output_id)
      .executeTakeFirst();
    if (!revision) throw new AgentError('agent_context_unavailable');
    upstream = {
      ...revision,
      source_refs: revisionRefs(revision.source_refs),
      evidence_state: 'upstream deliverable; source references require re-fetching',
    };
  }
  const targetUrl =
    target?.normalized_url ||
    refs.target_url?.trim() ||
    site?.normalized_url ||
    (groupRef?.site_url_id ? issueGroup?.occurrences[0]?.display_url : '') ||
    owned(opportunity?.target_url, project.website_url) ||
    owned(demand?.signal.page_url, project.website_url) ||
    '';
  return {
    project,
    target,
    opportunity,
    demand,
    site,
    search,
    targetUrl,
    issueGroup,
    siteFacts,
    upstream,
  };
}

export const readAgentContext: ContextReader = async (db, scope, raw, request) => {
  try {
    const refs = agentContextRefsSchema.parse(raw);
    const {
      project,
      target,
      opportunity,
      demand,
      site,
      search,
      targetUrl,
      issueGroup,
      siteFacts,
      upstream,
    } = await resolveOrigins(db, scope, refs);
    const query = [request, opportunity?.target_theme, demand?.signal.topic_cluster]
      .filter(Boolean)
      .join(' ');
    const crawlIds = new Set(
      [
        refs.issue_group_reference?.crawl_id,
        refs.site_facts_reference?.crawl_id,
        refs.site_health_reference?.crawl_id,
      ].filter((id) => id !== undefined),
    );
    if (crawlIds.size > 1) throw new AgentError('agent_context_conflict');
    const [selectedCrawl] = crawlIds;
    const selection = await selectContentFragments(db, scope, query, targetUrl, selectedCrawl);
    const targetPage = selection.pages.find(
      (page) =>
        page.site_url_id === target?.id ||
        (targetUrl && comparableUrl(page.final_url) === comparableUrl(targetUrl)),
    );
    const related = selection.pages.filter((page) => page !== targetPage);
    const memory = await readBrandMemory(db, scope);
    const aliases = await db
      .selectFrom('brand_aliases as a')
      .innerJoin('brands as b', 'b.id', 'a.brand_id')
      .innerJoin('projects as p', 'p.id', 'b.project_id')
      .select('a.alias')
      .where('p.workspace_id', '=', scope.workspaceId)
      .where('p.id', '=', scope.projectId)
      .orderBy('a.created_at')
      .execute();
    const competitors = await db
      .selectFrom('competitors as c')
      .innerJoin('projects as p', 'p.id', 'c.project_id')
      .select('c.name')
      .where('p.workspace_id', '=', scope.workspaceId)
      .where('p.id', '=', scope.projectId)
      .orderBy('c.created_at')
      .execute();
    const brand = {
      name: project.brand_name || project.name,
      website: project.website_url,
      country_code: project.country_code,
      primary_market: project.primary_market,
      language_code: project.language_code,
      aliases: aliases.map((row) => row.alias),
      competitors: competitors.map((row) => row.name),
      memory,
    };
    const evidence = Object.fromEntries(
      Object.entries({
        opportunity,
        demand,
        site_health: site,
        search_intelligence: search,
        issue_group: issueGroup,
        site_facts: siteFacts,
      }).filter(([, value]) => value != null),
    );
    return {
      version: policy.agent_context.content_context_version,
      brand_block: '',
      target_page_block: '',
      related_site_block: '',
      issue_block: '',
      sections: z.record(z.string(), z.json()).parse(
        plainJson({
          brand,
          target_page: targetPage ?? (targetUrl ? { url: targetUrl, state: 'unavailable' } : null),
          ...evidence,
          ...(upstream ? { upstream_revision: upstream } : {}),
          related_site: related,
        }),
      ),
      summary: z.record(z.string(), z.json()).parse(
        plainJson({
          ...record(selection.summary),
          brand_memory: memory !== null,
          brand_fields: memory ? Object.keys(memory.business_context) : [],
          target_page: targetPage?.title || targetUrl,
          target_url: targetUrl || null,
          related_page_count: related.length,
          crawl_page_count: selection.pages.length,
          crawl_urls: selection.pages.map((page) => page.final_url),
          evidence_block_count: Object.keys(evidence).length,
          opportunity_id: opportunity?.id ?? null,
          demand_signal_id: demand?.signal.id ?? null,
          demand_snapshot_id: demand?.snapshot.id ?? null,
          site_health_reference: refs.site_health_reference ?? null,
          search_intelligence_reference: refs.search_intelligence_reference ?? null,
          issue_group_reference: refs.issue_group_reference ?? null,
          site_facts_reference: refs.site_facts_reference ?? null,
          output_revision_reference: refs.output_revision_reference ?? null,
        }),
      ),
    };
  } catch (error) {
    if (
      (error instanceof ApiError && [404, 422].includes(error.status)) ||
      error instanceof McpInputError
    )
      throw new AgentError('agent_context_unavailable');
    throw error;
  }
};
