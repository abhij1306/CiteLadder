import { z } from 'zod';
import { isRecord } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import type { ExecutionResult } from '../audits/result-persistence.ts';
import { providerPolicy } from '../providers/config.ts';
import { classifySourceOrigin } from '../analysis/opportunities/source-patterns.ts';
import { lenient, list, listOf, nested, recordsOf, withRaw } from '../lenient-fields.ts';
import { searchPolicy, type SerpEngine } from './dataforseo.ts';
import {
  domain,
  emptyUsage,
  envelopeSchema,
  integer,
  kind,
  pending,
  stamped,
  text,
} from './payload.ts';
import { casefold } from '../casefold.ts';
import { onlyOf } from '../lists.ts';

type SurfaceLink = { url: string; domain: string; title: string; element_index: number };
type SurfaceReference = {
  url: string;
  domain: string;
  title: string;
  source_origin: string;
};
export type OverviewResult = {
  outcome: string;
  provider_status_code: number | null;
  error_code: string;
  aio_present: boolean | null;
  aio_serp_position: number | null;
  answer_text: string;
  aio_markdown: string;
  elements: Record<string, unknown>[];
  links: SurfaceLink[];
  references: SurfaceReference[];
  provider_cost_microusd: number | null;
  observed_at: Date | null;
  raw_payload: Record<string, unknown>;
};
export function surfaceFailure(errorCode: string): OverviewResult {
  if (!searchPolicy.surface.execution_failure_codes.includes(errorCode))
    throw new Error('Invalid surface failure code');
  return emptyOverview(searchPolicy.surface.outcome_execution_failure, {}, null, errorCode);
}
function emptyOverview(
  outcome: string,
  raw: Record<string, unknown>,
  status: number | null = null,
  errorCode = '',
): OverviewResult {
  return {
    outcome,
    raw_payload: raw,
    provider_status_code: status,
    error_code: errorCode,
    aio_present: null,
    aio_serp_position: null,
    answer_text: '',
    aio_markdown: '',
    elements: [],
    links: [],
    references: [],
    provider_cost_microusd: null,
    observed_at: null,
  };
}
const linkSchema = z.object({
  url: lenient((value) => scalarText(value).trim()),
  domain: lenient(scalarText),
  title: lenient(scalarText),
});
const componentShape = {
  title: lenient(text),
  text: lenient(text),
  markdown: lenient(text),
  links: listOf(linkSchema),
  references: listOf(linkSchema),
};
const elementSchema = withRaw(
  z.object({
    ...componentShape,
    type: kind,
    snippet: lenient(text),
    table: nested({
      table_header: lenient((value) => list(value).map(text)),
      table_content: lenient((value) =>
        list(value).map((row) => list(row).map(text).filter(Boolean).join(' ')),
      ),
    }),
    items: lenient((value): { texts: string[]; children: unknown[] } => {
      const items = list(value);
      return { texts: items.map(text), children: items.filter(isRecord) };
    }),
    components: listOf(z.object(componentShape)),
  }),
);
type OverviewElement = z.output<typeof elementSchema>;
function optionalList(value: unknown): unknown[] | null {
  if (value == null) return [];
  return Array.isArray(value) ? value : null;
}
const blockSchema = z.object({
  type: kind,
  items: lenient(optionalList),
  markdown: lenient(scalarText),
  rank_absolute: lenient(integer),
  references: listOf(linkSchema),
});
type OverviewBlock = z.output<typeof blockSchema>;
const pageSchema = lenient((value) =>
  isRecord(value) && Object.keys(value).length
    ? stamped({
        items: lenient((items) => optionalList(items) && recordsOf(blockSchema, items)),
      }).parse(value)
    : null,
);
const withComponents = (element: OverviewElement) => [element, ...element.components];
function elements(engine: SerpEngine, block: OverviewBlock): [number, OverviewElement][] {
  if (block.items === null) throw new Error('Invalid overview elements');
  const answerTypes: readonly string[] = searchPolicy.serp.answer_element_types[engine];
  const skippedTypes: readonly string[] = searchPolicy.serp.skipped_element_types[engine];
  const result: [number, OverviewElement][] = [];
  function descend(value: unknown, index: number, depth: number) {
    const node = elementSchema.parse(value);
    if (skippedTypes.includes(node.type)) return;
    if (depth > 128 || !answerTypes.includes(node.type))
      throw new Error('Unknown overview element');
    result.push([index, node]);
    for (const child of node.items.children) descend(child, index, depth + 1);
  }
  block.items.forEach((node, index) => descend(node, index, 0));
  return result;
}
function fragments(element: OverviewElement) {
  const values = [
    element.title,
    element.text,
    element.snippet,
    ...element.table.table_header,
    ...element.table.table_content,
    ...element.items.texts,
    ...element.components.flatMap((part) => [part.title, part.text || part.markdown]),
  ].filter(Boolean);
  return values.length ? values : [element.markdown].filter(Boolean);
}
type Envelope = z.output<typeof envelopeSchema>;
type OverviewTask = Envelope['tasks'][number];
type OverviewPage = NonNullable<z.output<typeof pageSchema>>;
type ResolvedTask = { task: OverviewTask; status: number; page: OverviewPage | null };
function resolveOverviewTask(
  engine: SerpEngine,
  envelope: Envelope,
  expectedId: string,
): ResolvedTask | { early: OverviewResult | 'still_pending' } {
  const c = searchPolicy.constants,
    s = searchPolicy.surface;
  if (envelope.status_code !== null && envelope.status_code !== c.status_ok)
    return { early: emptyOverview(s.outcome_provider_error, envelope.raw, envelope.status_code) };
  const task = onlyOf(envelope.tasks.filter((t) => scalarText(t.id) === expectedId));
  if (!task)
    return {
      early: emptyOverview(s.outcome_parser_error, {
        parse_error: 'task identity is missing or ambiguous',
        payload: envelope.raw,
      }),
    };
  const status = task.status_code;
  if (pending(status)) return { early: 'still_pending' };
  if (status === null) return { early: emptyOverview(s.outcome_parser_error, task.raw) };
  const absentCodes: readonly number[] = searchPolicy.serp.absent_status_codes[engine];
  if (absentCodes.includes(status)) return { task, status, page: null };
  if (status !== c.status_ok)
    return { early: emptyOverview(s.outcome_provider_error, task.raw, status) };
  const page = pageSchema.parse(task.result[0]);
  if (!task.result.length || !page || page.items === null)
    return { early: emptyOverview(s.outcome_parser_error, task.raw) };
  return { task, status, page };
}
function overviewContent(walked: [number, OverviewElement][]) {
  const seenText = new Set<string>(),
    parts: string[] = [];
  const links = new Map<string, SurfaceLink>();
  for (const [index, element] of walked) {
    for (const fragment of fragments(element)) {
      const key = casefold(fragment.split(/\s+/u).filter(Boolean).join(' '));
      if (!key || seenText.has(key)) continue;
      seenText.add(key);
      parts.push(fragment.trim());
    }
    for (const link of withComponents(element).flatMap((part) => part.links)) {
      if (link.url && !links.has(link.url))
        links.set(link.url, {
          url: link.url,
          domain: domain(link.domain || link.url),
          title: link.title,
          element_index: index,
        });
    }
  }
  return { parts, links };
}
function overviewReferences(block: OverviewBlock, walked: [number, OverviewElement][]) {
  const references = new Map<string, SurfaceReference>();
  const owners = [block, ...walked.flatMap(([, element]) => withComponents(element))];
  for (const ref of owners.flatMap((owner) => owner.references)) {
    const host = domain(ref.domain || ref.url);
    if (ref.url && !references.has(ref.url))
      references.set(ref.url, {
        url: ref.url,
        domain: host,
        title: ref.title,
        source_origin: classifySourceOrigin(host),
      });
  }
  return references;
}
export function parseOverview(
  engine: SerpEngine,
  payload: unknown,
  expectedId: string,
): OverviewResult | 'still_pending' {
  const s = searchPolicy.surface;
  const resolved = resolveOverviewTask(engine, envelopeSchema.parse(payload), expectedId);
  if ('early' in resolved) return resolved.early;
  const { task, status, page } = resolved;
  const block = (page?.items ?? []).find((item) => item.type === 'ai_overview');
  const base = {
    ...emptyOverview(
      block ? s.outcome_ai_overview_present : s.outcome_no_ai_overview,
      task.raw,
      status,
    ),
    aio_present: Boolean(block),
    observed_at: page?.observed_at ?? task.observed_at,
    provider_cost_microusd: task.cost,
  };
  if (!block) return base;
  try {
    const walked = elements(engine, block),
      { parts, links } = overviewContent(walked);
    const references = overviewReferences(block, walked);
    return {
      ...base,
      answer_text: parts.join('\n\n'),
      aio_markdown: block.markdown,
      aio_serp_position: block.rank_absolute,
      elements: walked.map(([, element]) => element.raw),
      links: [...links.values()],
      references: [...references.values()],
    };
  } catch {
    return emptyOverview(
      s.outcome_parser_error,
      { parse_error: 'unsupported overview structure', payload: task.raw },
      status,
    );
  }
}
export function overviewAnswer(engine: SerpEngine, result: OverviewResult): ExecutionResult {
  const route = providerPolicy.routes[engine];
  return {
    logical_engine: engine,
    transport_provider: 'dataforseo',
    transport_model: route.transport_model,
    answer_text: result.answer_text,
    search_used: false,
    search_events: [],
    citations: result.references.map((ref, index) => ({
      ordinal: index,
      url: ref.url,
      title: ref.title,
      domain: ref.domain,
      start_index: null,
      end_index: null,
      cited_text: '',
    })),
    retrieved_sources: null,
    finish_reason: 'unknown',
    raw_finish_reason: '',
    latency_ms: 0,
    normalized_usage: { ...emptyUsage, provider_cost_microusd: result.provider_cost_microusd },
    provider_metadata: {
      raw_response: result.raw_payload,
      search_surface_outcome: result.outcome,
      provider_status_code: result.provider_status_code,
      aio_serp_position: result.aio_serp_position,
      aio_markdown: result.aio_markdown,
      query_text_available: false,
      fanout_availability: 'unavailable',
    },
  };
}
