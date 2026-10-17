/** Transient observed-crawl graph. Unobserved targets never become authority nodes. */
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { compareText } from '../text-order.ts';
import { onlyOf } from '../lists.ts';
import { canonicalUrl as canonical } from './url-identity.ts';
import { anchorDestinations, anchorDiagnostics } from './link-anchors.ts';

export type LinkPage = {
  id: string;
  url: string;
  finalUrl: string;
  artifactId: string;
  facts: Record<string, unknown>;
  aliases: string[];
};
export type LinkEdge = {
  source: string;
  sourceUrl: string;
  target: string | null;
  targetUrl: string;
  count: number;
  main: boolean;
  nofollow: boolean;
  follow: boolean;
  rel: Set<string>;
  weights: number[];
  anchors: { text: string; region: string }[];
};
const p = policy.site_health.link_metrics;
function aliasesFor(pages: LinkPage[]) {
  const result = new Map<string, string>();
  for (const page of pages) {
    const url = canonical(page.url);
    if (url) result.set(url, page.id);
  }
  const claims = new Map<string, Set<string>>();
  for (const page of pages)
    for (const raw of [page.finalUrl, ...page.aliases]) {
      const url = canonical(raw);
      if (!url || result.has(url)) continue;
      const owners = claims.get(url) ?? new Set<string>();
      owners.add(page.id);
      claims.set(url, owners);
    }
  for (const [url, owners] of claims) {
    const owner = onlyOf(owners);
    if (owner !== undefined) result.set(url, owner);
  }
  return result;
}
function relTokens(raw: unknown) {
  let values: unknown[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === 'string') values = raw.replaceAll(',', ' ').split(/\s+/u);
  return new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}
function update(edge: LinkEdge, anchor: Record<string, unknown>, pageNofollow: boolean) {
  const rel = relTokens(anchor.rel);
  const nofollow = pageNofollow || rel.has('nofollow');
  const main = anchor.region === 'main';
  edge.count += 1;
  edge.main ||= main;
  edge.nofollow ||= nofollow;
  edge.follow ||= !nofollow;
  for (const token of rel)
    if (['nofollow', 'sponsored', 'ugc'].includes(token)) edge.rel.add(token);
  edge.weights.push(
    p.edge_weights.find((row) => row.main === main && row.follow === !nofollow)!.weight,
  );
  edge.anchors.push({
    text: typeof anchor.anchor_text === 'string' ? anchor.anchor_text : '',
    region: typeof anchor.region === 'string' ? anchor.region : 'unknown',
  });
}
function pageEdges(page: LinkPage, aliases: Map<string, string>, nodes: Map<string, string>) {
  const merged = new Map<string, LinkEdge>();
  const raw = record(page.facts.links).anchors;
  const pageNofollow = record(page.facts.robots).nofollow === true;
  for (const value of Array.isArray(raw) ? raw : []) {
    const anchor = record(value);
    if (anchor.is_internal !== true || typeof anchor.url !== 'string') continue;
    const url = canonical(anchor.url, page.finalUrl);
    if (!url) continue;
    const target = aliases.get(url) ?? null;
    const key = target ?? url;
    const edge = merged.get(key) ?? {
      source: page.id,
      sourceUrl: page.url,
      target,
      targetUrl: target ? nodes.get(target)! : url,
      count: 0,
      main: false,
      nofollow: false,
      follow: false,
      rel: new Set<string>(),
      weights: [],
      anchors: [],
    };
    update(edge, anchor, pageNofollow);
    merged.set(key, edge);
  }
  return [...merged.values()].sort((a, b) => compareText(a.targetUrl, b.targetUrl));
}
function depths(home: string | undefined, outgoing: Map<string, LinkEdge[]>) {
  const result = new Map<string, number>();
  if (!home) return result;
  result.set(home, 0);
  const queue = [home];
  for (const current of queue)
    for (const edge of outgoing.get(current) ?? []) {
      if (!edge.follow || !edge.target || result.has(edge.target)) continue;
      result.set(edge.target, result.get(current)! + 1);
      queue.push(edge.target);
    }
  return result;
}
function weight(edge: LinkEdge) {
  const [strongest, ...repeated] = [...edge.weights].sort((a, b) => b - a);
  if (strongest === undefined) throw new Error('Expected a link edge with at least one anchor');
  return strongest + p.repeated_anchor_factor * repeated.reduce((sum, value) => sum + value, 0);
}
function authorityStep(
  ids: string[],
  outgoing: Map<string, LinkEdge[]>,
  shares: Map<string, number>,
) {
  const damping = p.damping_factor;
  const observed = ids.map((id) => ({
    id,
    edges: outgoing.get(id)!.filter((edge) => edge.target !== null),
  }));
  const dangling = observed
    .filter(({ edges }) => !edges.length)
    .reduce((sum, { id }) => sum + shares.get(id)!, 0);
  const base = (1 - damping + damping * dangling) / ids.length;
  const next = new Map(ids.map((id) => [id, base]));
  for (const { id, edges } of observed) {
    const total = edges.reduce((sum, edge) => sum + weight(edge), 0);
    for (const edge of edges)
      next.set(
        edge.target!,
        next.get(edge.target!)! + (damping * shares.get(id)! * weight(edge)) / total,
      );
  }
  const total = [...next.values()].reduce((sum, value) => sum + value, 0);
  return new Map([...next].map(([id, value]) => [id, value / total]));
}
function authority(ids: string[], outgoing: Map<string, LinkEdge[]>) {
  let shares = new Map(ids.map((id) => [id, 1 / ids.length]));
  for (let i = 0; i < p.max_iterations && ids.length; i += 1) {
    const next = authorityStep(ids, outgoing, shares);
    const delta = ids.reduce((sum, id) => sum + Math.abs(shares.get(id)! - next.get(id)!), 0);
    shares = next;
    if (delta <= p.convergence_epsilon) break;
  }
  return shares;
}
function neighbours(edges: LinkEdge[], inbound: boolean, limit: number) {
  return [...edges]
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(b.main) - Number(a.main) ||
        compareText(inbound ? a.sourceUrl : a.targetUrl, inbound ? b.sourceUrl : b.targetUrl) ||
        compareText(inbound ? a.source : (a.target ?? ''), inbound ? b.source : (b.target ?? '')),
    )
    .slice(0, Math.max(0, limit))
    .map((edge) => ({
      site_url_id: inbound ? edge.source : edge.target,
      url: inbound ? edge.sourceUrl : edge.targetUrl,
      anchor_count: edge.count,
      main_content: edge.main,
      nofollow: edge.nofollow,
      rel: [...edge.rel].sort(compareText),
    }));
}
export function buildLinkMetrics(
  input: LinkPage[],
  homeUrl: string,
  limit = p.top_neighbour_limit,
) {
  const pages = [...input].sort((a, b) => compareText(a.id, b.id));
  const aliases = aliasesFor(pages);
  const nodes = new Map(pages.map((page) => [page.id, canonical(page.url) ?? page.url]));
  const outgoing = new Map(pages.map((page) => [page.id, pageEdges(page, aliases, nodes)]));
  const inbound = new Map(pages.map((page) => [page.id, [] as LinkEdge[]]));
  for (const edges of outgoing.values())
    for (const edge of edges) if (edge.target) inbound.get(edge.target)!.push(edge);
  const depth = depths(aliases.get(canonical(homeUrl) ?? ''), outgoing);
  const ids = pages.map((page) => page.id);
  const shares = authority(ids, outgoing);
  const ranks = new Map(
    [...ids]
      .sort((a, b) => shares.get(b)! - shares.get(a)! || compareText(a, b))
      .map((id, index) => [id, index + 1]),
  );
  const sources = [...new Set(pages.map((page) => page.artifactId))].sort(compareText);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const destinations = anchorDestinations(outgoing);
  return pages.map((page) => {
    const outs = outgoing.get(page.id)!;
    const ins = inbound.get(page.id)!;
    return {
      site_url_id: page.id,
      inbound_count: ins.length,
      outbound_count: outs.length,
      main_content_inbound_count: ins.filter((edge) => edge.main).length,
      main_content_outbound_count: outs.filter((edge) => edge.main).length,
      nofollow_inbound_count: ins.filter((edge) => edge.nofollow).length,
      depth_from_home: depth.get(page.id) ?? null,
      source_page_count: pages.length,
      authority_share: shares.get(page.id)!,
      authority_rank: ranks.get(page.id)!,
      top_inbound: neighbours(ins, true, limit),
      top_outbound: neighbours(outs, false, limit),
      source_artifact_ids: sources,
      anchor_diagnostics: anchorDiagnostics(outs, byId, destinations),
    };
  });
}
