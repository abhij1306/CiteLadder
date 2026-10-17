import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { AuditTasks } from '../generated/db-schema.ts';
import { record } from '../db/json.ts';
import { executionFrozenProvenance, modelProvenanceFor } from '../analysis/provenance.ts';
import { rowsToCsv } from '../analysis/opportunities/exports.ts';
import { engineSnapshots } from '../visibility/runs.ts';
import { authorizedAudit } from './reads.ts';
import { round } from '../analysis/round.ts';
import { compareText, scalarText } from '../text-order.ts';
import { onlyOf } from '../lists.ts';

const columns = [
  'audit_id',
  'prompt_index',
  'prompt_text',
  'repetition',
  'randomized_position',
  'logical_engine',
  'transport_model',
  'retrieval_enabled',
  'status',
  'search_used',
  'search_query_count',
  'search_queries',
  'prompt_class',
  'prompt_contains_brand',
  'prompt_contains_competitor',
  'brand_mentioned',
  'brand_injected_in_search',
  'owned_domain_cited',
  'owned_citation_count',
  'unintended_domain_cited',
  'citation_count',
  'citation_domains',
  'competitors_mentioned',
  'competitor_domains_cited',
  'fanout_features',
  'latency_ms',
  'error_code',
];
const bool = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return value ? 'True' : 'False';
};
const retrievalLabel = (enabled: boolean | null) => {
  if (enabled === null) return 'retrieval unrecorded';
  return enabled ? 'retrieval on' : 'retrieval off';
};
const benchmarkModeLabels: Record<string, string> = {
  consumer_like: 'exact visible prompt; no system instruction',
  controlled_localized: 'visible prompt plus disclosed market/language context',
  forced_grounded: 'disclosed market/language context plus forced current-web citations',
};
const array = (value: unknown) => (Array.isArray(value) ? value : []);
const joined = (value: unknown) =>
  !value || (Array.isArray(value) && !value.length) ? '' : JSON.stringify(value);
const pct = (value: unknown) => (typeof value === 'number' ? `${round(value * 100, 0)}%` : '—');
const usd = (value: unknown) => (typeof value === 'number' ? `$${value.toFixed(4)}` : '—');
/** The prompt-panel line: unavailable, all non-branded, or the mixed class counts. */
function promptPanel(classes: [string, unknown][]): string {
  if (!classes.length) return 'Prompt classification unavailable until executions complete.';
  if (onlyOf(classes)?.[0] === 'non_branded') return 'All prompts are unaided/non-branded.';
  return `Mixed panel: ${classes
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([key, count]) => `${key}=${count}`)
    .join(', ')}.`;
}
const md = (value: unknown) =>
  scalarText(value ?? '')
    .replaceAll('|', String.raw`\|`)
    .replaceAll(/[\r\n]/gu, ' ');

type ExportTask = Selectable<AuditTasks>;
type ExportAudit = Awaited<ReturnType<typeof authorizedAudit>>;
function csvExport(tasks: ExportTask[], audit: ExportAudit) {
  return rowsToCsv(
    tasks.map((task) => {
      const score = record(task.score);
      return {
        audit_id: audit.id,
        prompt_index: task.prompt_index,
        prompt_text: task.prompt_text,
        repetition: task.repetition,
        randomized_position: task.randomized_position,
        logical_engine: task.logical_engine,
        transport_model: task.transport_model,
        retrieval_enabled: bool(
          executionFrozenProvenance({
            requestSnapshot: task.request_snapshot,
            routeSnapshot: task.provider_route_snapshot,
            auditConfiguration: audit.configuration,
          }),
        ),
        status: task.status,
        search_used: bool(task.search_used),
        search_query_count: score.search_query_count ?? 0,
        search_queries: joined(
          array(task.search_events).map((value) => record(value).query ?? null),
        ),
        prompt_class: score.prompt_class ?? '',
        prompt_contains_brand: bool(score.prompt_contains_brand ?? false),
        prompt_contains_competitor: bool(score.prompt_contains_competitor ?? false),
        brand_mentioned: bool(score.brand_mentioned ?? false),
        brand_injected_in_search: bool(score.brand_injected_in_search ?? false),
        owned_domain_cited: bool(score.owned_domain_cited ?? false),
        owned_citation_count: score.owned_citation_count ?? 0,
        unintended_domain_cited: bool(score.unintended_domain_cited ?? false),
        citation_count: score.citation_count ?? 0,
        citation_domains: joined(
          array(task.citations)
            .map((value) => record(value).domain)
            .filter(Boolean),
        ),
        competitors_mentioned: joined(score.competitors_mentioned),
        competitor_domains_cited: joined(score.competitor_domains_cited),
        fanout_features: joined(score.fanout_features),
        latency_ms: task.latency_ms,
        error_code: task.error_code,
      };
    }),
    columns,
  );
}
function competitorComparison(
  config: Record<string, unknown>,
  summary: Record<string, unknown>,
  brand: string,
): string[] {
  const competitors = array(config.competitors).map((item) => record(item).name);
  if (!competitors.length) return [];
  return [
    '## Competitor Comparison',
    '',
    '| Competitor | Mention rate | Citation rate |',
    '|---|---|---|',
    `| **${brand}** | ${pct(summary.brand_mention_rate)} | ${pct(summary.owned_citation_rate)} |`,
    ...competitors.map(
      (name) =>
        `| ${md(name)} | ${pct(record(summary.competitor_mention_rate)[String(name)])} | ${pct(record(summary.competitor_citation_rate)[String(name)])} |`,
    ),
    '',
  ];
}
async function markdownExport(db: Database, tasks: ExportTask[], audit: ExportAudit) {
  const config = record(audit.configuration),
    summary = record(audit.summary),
    cost = record(summary.cost);
  const routes = await engineSnapshots(db, [audit.id]);
  const provenance = modelProvenanceFor(routes.get(audit.id) ?? [], config);
  const brand = md(config.brand_name ?? 'Brand'),
    mode = String(config.benchmark_mode ?? audit.benchmark_mode);
  const classes = Object.entries(record(summary.prompt_class_counts)).filter(([, count]) => count);
  const panel = promptPanel(classes);
  const lines = [`# AI Search Visibility Audit — ${brand}`, '', '## Methodology', ''];
  if (provenance.length) {
    const routeLines = provenance.map(
      (item) =>
        `\`${item.logical_engine}\` via \`${item.transport_provider}\` model \`${item.transport_model}\` (${retrievalLabel(item.retrieval_enabled)})`,
    );
    lines.push(`- **Model provenance:** ${routeLines.join('; ')}.`);
  }
  lines.push(
    `- **Engines measured:** ${
      array(config.engines)
        .map((engine) => `\`${md(engine)}\``)
        .join(', ') || '—'
    }`,
    '- **Statelessness:** every prompt is a fresh, independent request. No account history or chat context influences any answer.',
    `- **Benchmark mode:** \`${mode}\` — ${benchmarkModeLabels[mode] ?? mode}.`,
  );
  if (mode && mode !== 'consumer_like')
    lines.push(
      `- **Localization:** benchmark context supplied country \`${md(config.country_code)}\` and language \`${md(config.language_code)}\` to the model; it was not inferred from device or account location.`,
    );
  lines.push(
    `- **Prompt panel:** ${panel} Brand and competitor data is applied only during scoring.`,
    `- **Panel fingerprint:** \`${md(config.panel_id ?? 'unavailable')}\`; prompt text hashes are frozen in the audit configuration.`,
    `- **Design:** ${audit.requested_count} executions (${audit.repetitions} repetition(s) per prompt x engine), execution order randomized (seed \`${audit.random_seed}\`).`,
    '- **Citations:** only explicit source citations returned by the API are counted. Publisher domains prefer resolved/direct URLs and use the citation title only as fallback; this is not a complete ledger of every page the model read.',
    `- **Scoring:** deterministic alias/domain matching (\`${audit.analyzer_version || 'unversioned'}\`). No LLM is used for headline metrics. Answer perception (sentiment) is classified separately by a model over the passages that name each business, keeps only quotes found verbatim in the answer, and is reported with its coverage in the Perception view, not in these metrics.`,
    `- **Result:** ${scalarText(summary.total_completed ?? 0)} completed, ${audit.failed_count} failed.`,
    '',
    '## Headline Metrics',
    '',
    '| Metric | Value |',
    '|---|---|',
  );
  for (const [label, key] of [
    ['Brand mention rate', 'brand_mention_rate'],
    ['Owned-domain citation rate', 'owned_citation_rate'],
    ['Mention → owned-citation conversion', 'mention_to_owned_citation_conversion'],
    ['Search-use rate', 'search_use_rate'],
    ['Brand injected into search fanout', 'brand_fanout_injection_rate'],
    ['Unintended-domain citation rate', 'unintended_domain_citation_rate'],
  ])
    lines.push(`| ${label} | ${pct(summary[key!])} |`);
  lines.push(
    `| Avg. search queries / answer | ${scalarText(summary.avg_queries_per_execution ?? 0)} |`,
    `| Paid-list token cost estimate | ${usd(cost.paid_list_token_estimate_usd)} |`,
    `| Grounding cost if outside free allowance | ${usd(cost.grounding_cost_if_billable_usd)} |`,
  );
  if (typeof cost.provider_reported_cost_usd === 'number' && cost.provider_reported_cost_usd > 0)
    lines.push(`| Provider-reported cost | ${usd(cost.provider_reported_cost_usd)} |`);
  lines.push(
    `| Grounded requests | ${scalarText(cost.grounded_requests ?? 0)} |`,
    '',
    ...competitorComparison(config, summary, brand),
    '## Per-Prompt Results (with immediate binary consistency)',
    '',
    '| # | Prompt | Theme | Brand mentioned | Owned cited | Immediate consistency |',
    '|---|---|---|---|---|---|',
  );
  for (const value of array(summary.per_prompt)) {
    const row = record(value);
    lines.push(
      `| ${scalarText(row.prompt_index)} | ${md(row.prompt_text)} | ${md(row.theme)} | ${scalarText(row.brand_mentioned_count)}/${scalarText(row.repetitions ?? 0)} | ${scalarText(row.owned_cited_count)}/${scalarText(row.repetitions ?? 0)} | ${pct(row.mention_stability)} |`,
    );
  }
  lines.push('');
  const domains = Object.entries(record(summary.citation_annotation_share_by_domain));
  if (domains.length) {
    lines.push(
      '## Top Domains by Inline Citation-Annotation Share',
      '',
      '| Domain | Share of citations |',
      '|---|---|',
    );
    for (const [domain, share] of domains) lines.push(`| ${md(domain)} | ${pct(share)} |`);
    lines.push('');
  }
  const failures = tasks.filter((task) => task.status === 'failed');
  if (failures.length) {
    lines.push(
      '## Failed Executions',
      '',
      '| Prompt | Repetition | Engine | Error |',
      '|---|---|---|---|',
    );
    for (const task of failures)
      lines.push(
        `| ${md(task.prompt_text)} | ${task.repetition} | ${task.logical_engine} | ${task.error_code} |`,
      );
    lines.push('');
  }
  lines.push(
    '## Limitations',
    '',
    '- A single grounded API surface is not a proxy for all AI answer engines; provider APIs and consumer applications retrieve and route differently.',
    '- Grounded answers vary by date, index freshness and location; results are a point-in-time snapshot. Immediate repetitions measure short-term stability, not long-term visibility.',
    '- Search queries and citations reflect only explicit provider evidence. Missing query text is unavailable evidence.',
    '- Citations are response annotations, not proof of every page the model read.',
    '',
  );
  return lines.join('\n');
}
export async function exportAudit(
  db: Database,
  workspaceId: string,
  auditId: string,
  format: 'csv' | 'md',
) {
  const audit = await authorizedAudit(db, workspaceId, auditId);
  const tasks = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .orderBy('prompt_index')
    .orderBy('repetition')
    .execute();
  return format === 'csv' ? csvExport(tasks, audit) : markdownExport(db, tasks, audit);
}
