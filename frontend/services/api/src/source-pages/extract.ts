import { createHash } from 'node:crypto';
import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import { attribute, document, elements, visibleText } from '../web-evidence/html.ts';

const p = policy.source_pages;
export type ExtractedPage = ReturnType<typeof extractSourcePage>;
function schemaTypes(value: unknown, found: Set<string>, depth = 0): void {
  if (depth > p.schema_max_depth || found.size >= p.max_structured_types) return;
  if (Array.isArray(value)) {
    for (const item of value) schemaTypes(item, found, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const item = record(value);
  const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
  for (const type of types)
    if (typeof type === 'string' && found.size < p.max_structured_types) found.add(type);
  for (const child of Object.values(item)) schemaTypes(child, found, depth + 1);
}
export function extractSourcePage(body: Buffer, charset?: string) {
  const root = document(body, charset);
  const titleNode = [...elements(root, 'title')][0];
  const title = titleNode ? visibleText(titleNode).slice(0, p.title_max_chars) : '';
  const description = [...elements(root, 'meta')].find((node) =>
    ['description', 'og:description'].includes(
      (attribute(node, 'name') || attribute(node, 'property')).toLowerCase(),
    ),
  );
  const headings = [...elements(root)]
    .filter((node) => ['h1', 'h2', 'h3'].includes(node.tagName))
    .map((node) => visibleText(node).slice(0, p.title_max_chars))
    .filter(Boolean)
    .slice(0, p.max_headings);
  const table_headers = [...elements(root, 'table')]
    .slice(0, policy.content_differentiation.max_tables)
    .map((table) =>
      [...elements(table, 'th')]
        .map((node) => visibleText(node).slice(0, p.title_max_chars))
        .filter(Boolean)
        .slice(0, policy.content_differentiation.max_table_headers),
    );
  const types = new Set<string>();
  for (const node of elements(root, 'script')) {
    if (!attribute(node, 'type').toLowerCase().includes('ld+json')) continue;
    try {
      schemaTypes(JSON.parse(visibleText(node, false)), types);
    } catch {
      /* One malformed block cannot discard other evidence. */
    }
  }
  const outbound_domains = [
    ...new Set(
      [...elements(root, 'a')].flatMap((node) => {
        try {
          const url = new URL(attribute(node, 'href'));
          const domain = getDomain(url.hostname);
          return domain ? [domain] : [];
        } catch {
          return [];
        }
      }),
    ),
  ].slice(0, p.max_outbound_domains);
  const complete = visibleText([...elements(root, 'body')][0] ?? root);
  const facts = {
    title,
    meta_description: description
      ? attribute(description, 'content').trim().slice(0, p.title_max_chars)
      : '',
    headings,
    table_headers,
    structured_types: [...types],
    outbound_domains,
    text_truncated: complete.length > p.max_text_chars,
    parsed: body.length > 0,
  };
  const text = complete.slice(0, p.max_text_chars);
  const { outbound_domains: _domains, ...hashed } = facts;
  return {
    facts,
    text,
    extracted_chars: text.length,
    content_hash: createHash('sha256')
      .update(JSON.stringify({ ...hashed, text }))
      .digest('hex'),
  };
}
