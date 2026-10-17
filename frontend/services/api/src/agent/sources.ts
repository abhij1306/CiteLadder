/**
 * A turn's sources are the records its reads returned, not references the
 * model repeats. Record references are working values for later reads; they
 * never belong in text written for the user.
 */
import { fenceTracker } from '../config/skill-inputs.ts';

// Linear: a label never spans another `[`, so no start position rescans the
// same text, and `[^)]*` takes the URI and any padding before `)` in one pass.
const LINKED_REF = /\[([^[\]\n]+)\]\(\s*citeladder:\/\/[^)]*\)/giu;
// Trailing sentence punctuation belongs to the prose, not the reference.
const BARE_REF = /\(?citeladder:\/\/[^\s<>()[\]"']*[^\s<>()[\]"'.,;:!?]\)?/giu;
const UUID = /\(?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b\)?/giu;
// Most replies cite nothing; they skip the per-line work.
const ANY_REF = /citeladder:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-/iu;

function scrubLine(line: string) {
  const scrubbed = line.replace(LINKED_REF, '$1').replace(BARE_REF, '').replace(UUID, '');
  if (scrubbed === line) return line;
  // Removing a token can leave doubled spaces or a space before punctuation.
  return scrubbed
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ ([.,;:!?])/gu, '$1')
    .trimEnd();
}

/**
 * Removes record references and UUIDs from user-facing text. A fenced block is
 * left exact, because a skill's machine-readable submission may need its IDs.
 */
export function scrubRecordRefs(text: string) {
  if (!ANY_REF.test(text)) return text;
  const fences = fenceTracker();
  return text
    .split('\n')
    .map((line) => {
      const { marker, fenced } = fences(line);
      return marker || fenced ? line : scrubLine(line);
    })
    .join('\n');
}

/** The records one read returned, as the `citeladder://` references screens resolve. */
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
