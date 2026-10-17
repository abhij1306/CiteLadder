/** Descriptive anchor diagnostics; lexical overlap is never a relevance score. */
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import type { LinkEdge, LinkPage } from './link-graph.ts';

const p = policy.site_health.link_metrics;
const stopWords = new Set(policy.content_differentiation.stop_words);
function normalized(text: string) {
  return text.toLowerCase().trim().replaceAll(/\s+/gu, ' ');
}
function tokens(text: string) {
  return new Set(
    normalized(text)
      .split(/[^a-z0-9]+/u)
      .filter((value) => value && !stopWords.has(value)),
  );
}
function coverage(terms: Set<string>, text: string) {
  const target = tokens(text);
  if (!terms.size || !target.size) return null;
  return [...terms].filter((term) => target.has(term)).length / terms.size;
}
type Diagnostic = {
  kind: string;
  anchor_text: string;
  occurrences: number;
  destination_count: number;
  destinations: string[];
  regions: Set<string>;
  title_coverage: number | null;
  h1_coverage: number | null;
};
function diagnoses(text: string, target: LinkPage | undefined, destinations: Set<string>) {
  const rows: { kind: string; title: number | null; h1: number | null }[] = [];
  if (p.generic_texts.includes(text) || /^(?:https?:\/\/|www\.)/u.test(text))
    rows.push({ kind: 'generic', title: null, h1: null });
  if (destinations.size >= p.repeated_destination_min)
    rows.push({ kind: 'repeated_destination', title: null, h1: null });
  if (!target) return rows;
  const terms = tokens(text);
  const title = coverage(terms, typeof target.facts.title === 'string' ? target.facts.title : '');
  const headings = record(target.facts.headings).h1_texts;
  const h1 = coverage(
    terms,
    Array.isArray(headings) ? headings.filter((value) => typeof value === 'string').join(' ') : '',
  );
  if (
    title !== null &&
    h1 !== null &&
    title <= p.low_alignment_coverage_max &&
    h1 <= p.low_alignment_coverage_max
  )
    rows.push({
      kind: 'low_lexical_alignment',
      title: Number(title.toFixed(6)),
      h1: Number(h1.toFixed(6)),
    });
  return rows;
}
/** Site-wide destinations per normalized anchor text; build once per graph. */
export function anchorDestinations(outgoing: Map<string, LinkEdge[]>) {
  const destinations = new Map<string, Set<string>>();
  for (const sourceEdges of outgoing.values())
    for (const edge of sourceEdges)
      for (const fact of edge.anchors) {
        const text = normalized(fact.text);
        if (!text) continue;
        const urls = destinations.get(text) ?? new Set<string>();
        urls.add(edge.targetUrl);
        destinations.set(text, urls);
      }
  return destinations;
}
type Diagnosis = ReturnType<typeof diagnoses>[number];
function group(
  grouped: Map<string, Diagnostic>,
  spec: Diagnosis,
  text: string,
  targetUrl: string,
  region: string,
  urls: Set<string>,
) {
  const alignment = spec.kind === 'low_lexical_alignment';
  const key = JSON.stringify([spec.kind, text, alignment ? targetUrl : '']);
  const row = grouped.get(key) ?? {
    kind: spec.kind,
    anchor_text: text,
    occurrences: 0,
    destination_count: alignment ? 1 : urls.size,
    destinations: alignment ? [targetUrl] : [...urls].sort(compareText),
    regions: new Set<string>(),
    title_coverage: spec.title,
    h1_coverage: spec.h1,
  };
  row.occurrences += 1;
  row.regions.add(region);
  grouped.set(key, row);
}
export function anchorDiagnostics(
  edges: LinkEdge[],
  pages: Map<string, LinkPage>,
  destinations: Map<string, Set<string>>,
) {
  const grouped = new Map<string, Diagnostic>();
  for (const edge of edges) {
    const target = edge.target ? pages.get(edge.target) : undefined;
    for (const fact of edge.anchors) {
      const text = normalized(fact.text);
      if (!text) continue;
      const urls = destinations.get(text)!;
      for (const spec of diagnoses(text, target, urls))
        group(grouped, spec, text, edge.targetUrl, fact.region, urls);
    }
  }
  return [...grouped]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, row]) => ({ ...row, regions: [...row.regions].sort(compareText) }));
}
