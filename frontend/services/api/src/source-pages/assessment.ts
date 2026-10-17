/** Exact quoted matches and explicit abstention when an extraction cannot establish absence. */
import { policy } from '../config.ts';
import { routePageKind } from '../site-health/routes.ts';
import type { ExtractedPage } from './extract.ts';
import { publicUrl } from '../projects/safe-fetch.ts';
import {
  DENSE_SCRIPT,
  entityOffset,
  normalizeAlias,
  normalizeText,
  type EntityPolicy,
} from '../analysis/aliases.ts';
import { scoringConfig } from '../analysis/scoring.ts';

const p = policy.source_pages;
type Passage = { text: string; char_start: number; char_end: number; entity_ref: string };
export type Presence = {
  entity_kind: string;
  entity_name: string;
  presence: string;
  match_method: string;
  match_count: number;
  first_offset: number | null;
  passage_refs: number[];
};
export function urlFormat(value: string): { format: string; method: string } {
  let url: URL;
  try {
    url = publicUrl(value);
  } catch {
    return { format: 'unresolved', method: 'none' };
  }
  const slug = url.pathname
    .toLowerCase()
    .replaceAll(/[/_+.]+/gu, '-')
    .replaceAll(/-{2,}/gu, '-');
  for (const [pattern, format] of p.url_formats)
    if (new RegExp(pattern!).test(slug)) return { format: format!, method: 'url_pattern' };
  const kind = routePageKind(url.href);
  const format = kind ? p.kind_formats[kind as keyof typeof p.kind_formats] : undefined;
  if (format) return { format, method: 'url_pattern' };
  return /(^|-)\d{4}-\d{2}(-|$)/u.test(slug)
    ? { format: 'article', method: 'url_pattern' }
    : { format: 'unresolved', method: 'none' };
}
/**
 * The page's own account of its shape. A specific schema type wins; a list or
 * comparison heading beats generic Article markup, because most CMSs mark
 * every post up as an Article whatever its shape.
 */
function pageFormat(page: ExtractedPage) {
  if (!page.facts.parsed) return { format: 'unresolved', method: 'none' };
  const types = new Set(
    page.facts.structured_types.map((s) => s.replace(/\/$/u, '').split('/').at(-1)!.toLowerCase()),
  );
  for (const [token, format] of p.schema_formats)
    if (types.has(token!)) return { format: format!, method: 'structured_data' };
  const title = [page.facts.title, ...page.facts.headings].join(' ');
  for (const [pattern, format] of p.heading_formats)
    if (new RegExp(pattern!, 'iu').test(title))
      return { format: format!, method: 'heading_evidence' };
  return p.generic_schema_types.some((token) => types.has(token))
    ? { format: 'article', method: 'structured_data' }
    : { format: 'unresolved', method: 'none' };
}
const escape = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const WORD = String.raw`[\p{L}\p{N}_]`;
/** Word boundaries apply only to scripts written with spaces. */
const bounded = (body: string, alias: string) =>
  DENSE_SCRIPT.test(alias)
    ? new RegExp(body, 'giu')
    : new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'giu');
/**
 * Raw-text spellings of an alias, so a positive verdict can quote the page:
 * the alias as written, then its characters in order with short separator
 * runs between them, so "northwindacademy" finds "Northwind Academy".
 */
function spellings(alias: string): RegExp[] {
  const compact = [...normalizeAlias(alias).replaceAll(' ', '')];
  // Separators are disjoint from the alias alphabet so matching never backtracks across them.
  const joined = compact.map(escape).join(String.raw`[^\p{L}\p{M}\p{N}_]{0,3}`);
  return [bounded(escape(alias), alias), ...(compact.length ? [bounded(joined, alias)] : [])];
}
/** Up to the per-entity quote allowance, so one entity never starves the others. */
function quote(text: string, matches: RegExpExecArray[], ref: string, passages: Passage[]) {
  const refs: number[] = [];
  for (const match of matches.slice(0, p.passages_per_entity)) {
    const half = Math.max(0, Math.floor((p.passage_chars - match[0].length) / 2));
    const start = Math.max(0, match.index - half);
    const end = Math.min(text.length, match.index + match[0].length + half);
    refs.push(passages.length);
    passages.push({
      text: text.slice(start, end).trim(),
      char_start: start,
      char_end: end,
      entity_ref: ref,
    });
  }
  return refs;
}
type Entity = { kind: string; name: string; aliases: string[]; matching?: EntityPolicy };
/**
 * Whether the page names the entity, decided by the same matcher and mention
 * rules that judge answers, so a name counts on a page exactly when it would
 * count in an answer. Every positive verdict carries a quoted passage.
 */
function entity(page: PageText, item: Entity, passages: Passage[]): Presence {
  const { text } = page;
  const aliases = [...new Set([item.name, ...item.aliases].map((a) => a.trim()))].filter(
    (a) => a.length >= p.min_alias_chars,
  );
  const named = { entity_kind: item.kind, entity_name: item.name };
  const offset = entityOffset(page.normalized, aliases, item.matching);
  if (offset === null)
    return {
      ...named,
      presence: page.sufficient ? 'not_detected' : 'partial',
      match_method: 'none',
      match_count: 0,
      first_offset: null,
      passage_refs: [],
    };
  for (const pattern of aliases.flatMap(spellings)) {
    const matches = [...text.matchAll(pattern)];
    const [first] = matches;
    if (!first) continue;
    const found = first[0].toLowerCase();
    return {
      ...named,
      presence: 'present',
      match_method: aliases.some((alias) => alias.toLowerCase() === found)
        ? 'exact_alias'
        : 'normalized_alias',
      match_count: matches.length,
      first_offset: first.index,
      passage_refs: quote(text, matches, `${item.kind}:${normalizeAlias(item.name)}`, passages),
    };
  }
  // Named, but in a spelling no raw window reproduces ("and" for "&"): nothing to quote.
  return {
    ...named,
    presence: 'ambiguous',
    match_method: 'normalized_alias',
    match_count: 1,
    first_offset: offset,
    passage_refs: [],
  };
}
/** The page's text, normalized once for every entity matched against it. */
type PageText = { text: string; normalized: string; sufficient: boolean };
export function assessPage(page: ExtractedPage, configuration: unknown) {
  const config = scoringConfig(configuration);
  const passages: Passage[] = [];
  const text = [page.facts.title, page.facts.meta_description, page.text].filter(Boolean).join(' ');
  const read: PageText = {
    text,
    normalized: normalizeText(text),
    sufficient:
      page.facts.parsed &&
      !page.facts.text_truncated &&
      page.extracted_chars >= p.min_coverage_chars,
  };
  const brand = config.brandName.trim();
  const presences: Presence[] = brand
    ? [
        entity(
          read,
          {
            kind: 'brand',
            name: brand,
            aliases: config.brandAliases,
            matching: config.brandMatching,
          },
          passages,
        ),
      ]
    : [];
  for (const competitor of config.competitors) {
    const name = competitor.name.trim();
    if (name)
      presences.push(
        entity(
          read,
          { kind: 'competitor', name, aliases: competitor.aliases, matching: competitor.matching },
          passages,
        ),
      );
  }
  return { ...pageFormat(page), presences, passages };
}
