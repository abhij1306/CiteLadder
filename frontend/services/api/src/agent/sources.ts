import { record } from '../db/json.ts';
import type { WebSource } from '../models/conversation.ts';
import { agentPolicy } from './contracts.ts';

// Linear: a label never spans another `[`, so no start position rescans the
// same text, and `[^)]*` takes the URI and any padding before `)` in one pass.
const LINKED_REF = /\[([^[\]\n]+)\]\(\s*citeladder:\/\/[^)]*\)/giu;
const BARE_REF = /\(?citeladder:\/\/[^\s<>()[\]"']*[^\s<>()[\]"'.,;:!?]\)?/giu;
const UUID_TEXT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(String.raw`(\(?)\b(${UUID_TEXT})\b(\)?)`, 'giu');
const WRITTEN_UUID = new RegExp(String.raw`\b${UUID_TEXT}\b`, 'giu');
const ANY_REF = /citeladder:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-/iu;

export function writtenIds(...texts: readonly string[]): ReadonlySet<string> {
  return new Set(
    texts.flatMap((text) => [...text.matchAll(WRITTEN_UUID)].map(([id]) => id.toLowerCase())),
  );
}

function scrubLine(line: string, keep: ReadonlySet<string>) {
  const scrubbed = line
    .replace(LINKED_REF, '$1')
    .replace(BARE_REF, '')
    .replace(UUID, (match: string, _open: string, id: string) =>
      keep.has(id.toLowerCase()) ? match : '',
    );
  if (scrubbed === line) return line;
  return scrubbed
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ ([.,;:!?])/gu, '$1')
    .trimEnd();
}

export function scrubRecordRefs(text: string, keep: ReadonlySet<string> = new Set()) {
  if (!ANY_REF.test(text)) return text;
  return text
    .split('\n')
    .map((line) => scrubLine(line, keep))
    .join('\n');
}

export function stepText(text: string) {
  return scrubRecordRefs(text.replaceAll(/\s+/gu, ' '))
    .trim()
    .slice(0, agentPolicy.step_detail_max_chars);
}

const TARGET_ARGUMENTS = ['url', 'query', 'domain', 'entity', 'folder'] as const;

export function stepTarget(input: unknown) {
  const args = record(input);
  for (const name of TARGET_ARGUMENTS) {
    const value = args[name];
    const text = typeof value === 'string' ? stepText(value) : '';
    if (text) return text;
  }
  return null;
}

export function readSources(refs: readonly { record_uri?: string | null }[]) {
  return refs.flatMap((ref) => (ref.record_uri ? [ref.record_uri] : []));
}

/**
 * Unique, in first-read order. Never truncated: derived work keeps its full
 * provenance, which the turn's read budget and the chat's turn limit bound.
 */
export function uniqueSources(...groups: Iterable<string>[]) {
  return [...new Set(groups.flatMap((group) => [...group]))];
}

export function uniqueWeb(...groups: readonly WebSource[][]) {
  const pages = new Map<string, string>();
  for (const { url, title } of groups.flat()) if (!pages.has(url)) pages.set(url, title);
  return [...pages].map(([url, title]) => ({ url, title }));
}
