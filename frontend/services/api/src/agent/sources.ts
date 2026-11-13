import type { WebSource } from '../models/conversation.ts';

/**
 * A turn's sources are the records its reads returned, not references the
 * model repeats. Record references are working values for later reads; they
 * never belong in text written for the user.
 */
// Linear: a label never spans another `[`, so no start position rescans the
// same text, and `[^)]*` takes the URI and any padding before `)` in one pass.
const LINKED_REF = /\[([^[\]\n]+)\]\(\s*citeladder:\/\/[^)]*\)/giu;
// Trailing sentence punctuation belongs to the prose, not the reference.
const BARE_REF = /\(?citeladder:\/\/[^\s<>()[\]"']*[^\s<>()[\]"'.,;:!?]\)?/giu;
const UUID_TEXT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(String.raw`(\(?)\b(${UUID_TEXT})\b(\)?)`, 'giu');
const WRITTEN_UUID = new RegExp(String.raw`\b${UUID_TEXT}\b`, 'giu');
// Most replies cite nothing; they skip the per-line work.
const ANY_REF = /citeladder:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-/iu;

/**
 * The UUIDs the person wrote, lower-cased: in their messages, or typed into a
 * document. An Agent save scrubs every other UUID, so one left in a saved
 * document came from the person.
 */
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
  // Removing a token can leave doubled spaces or a space before punctuation.
  return scrubbed
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ ([.,;:!?])/gu, '$1')
    .trimEnd();
}

/**
 * Removes record references and UUIDs from user-facing text, fenced blocks
 * included: no deliverable carries a machine-readable submission, so a
 * CiteLadder ID in a document is always a leak into Copy and Export. A UUID in
 * `keep` is the person's own (a form id in the HTML they pasted) and stays,
 * so code they supplied is never corrupted.
 */
export function scrubRecordRefs(text: string, keep: ReadonlySet<string> = new Set()) {
  if (!ANY_REF.test(text)) return text;
  return text
    .split('\n')
    .map((line) => scrubLine(line, keep))
    .join('\n');
}

/** The records one read supplied to the model, as the `citeladder://` references screens resolve. */
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

/** Web pages unique by URL, the first title kept; bounded by the turn's search budget. */
export function uniqueWeb(...groups: readonly WebSource[][]) {
  const pages = new Map<string, string>();
  for (const { url, title } of groups.flat()) if (!pages.has(url)) pages.set(url, title);
  return [...pages].map(([url, title]) => ({ url, title }));
}
