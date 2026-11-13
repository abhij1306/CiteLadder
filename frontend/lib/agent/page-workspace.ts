/**
 * The page workspace's reading of a page document (content optimization
 * phase 2, PR 3): its outline, the passages its suggestions sit in, the
 * highlights the editor draws, and the quoted reference Ask AI and Add to
 * context write into the composer. Offsets are UTF-16 code units of the
 * Markdown body, as the server and CodeMirror count them (E2).
 */
import type { AgentSuggestion } from '@/lib/api/agent';

type AgentPageField = Extract<AgentSuggestion['anchor'], { kind: 'field' }>['field'];

/** One heading of the body and the offset its line starts at. */
export type OutlineHeading = Readonly<{ level: number; text: string; from: number }>;

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/** End of `text` once trailing spaces and tabs before `end` are dropped. */
function blankTrimmedEnd(text: string, end: number): number {
  let at = end;
  while (at > 0 && isBlank(text[at - 1])) at--;
  return at;
}

/** A heading's content without trailing blanks or its optional closing `#` sequence. */
function headingContent(content: string): string {
  const end = blankTrimmedEnd(content, content.length);
  let hashes = end;
  while (hashes > 0 && content[hashes - 1] === '#') hashes--;
  const closed = hashes > 0 && hashes < end && isBlank(content[hashes - 1]);
  return content.slice(0, closed ? blankTrimmedEnd(content, hashes) : end);
}

/** Markdown's inline marks taken out, so a heading or passage reads as text. */
function inlineText(markdown: string): string {
  return markdown
    .replaceAll(/!?\[([^[\]]*)\]\([^)[]*\)/g, '$1')
    .replaceAll(/(\*\*|__|\*|_|`)/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** A fence closes on the same character at least as long; anything else keeps it open. */
function nextFence(open: string | null, marker: string): string | null {
  if (open === null) return marker;
  return marker.startsWith(open.charAt(0)) && marker.length >= open.length ? null : open;
}

/** The body's ATX headings in order; a `#` line inside fenced code is content. */
export function pageOutline(body: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of body.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) fence = nextFence(fence, marker);
    else if (fence === null) {
      const match = ATX_HEADING.exec(line);
      const text = match?.[2] ? inlineText(headingContent(match[2])) : '';
      if (match?.[1] && text) headings.push({ level: match[1].length, text, from: offset });
    }
    offset += line.length + 1;
  }
  return headings;
}

/** The block of the body (between blank lines) that holds `position`. */
function passageAt(body: string, position: number) {
  const before = body.lastIndexOf('\n\n', Math.max(0, position - 1));
  const after = body.indexOf('\n\n', position);
  return { start: before === -1 ? 0 : before + 2, end: after === -1 ? body.length : after };
}

const EXCERPT_CHARS = 90;

function excerpt(text: string): string {
  const plain = inlineText(text.replace(/^ {0,3}#{1,6}[ \t]+/, ''));
  return plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : plain;
}

const FIELD_LABEL: Record<AgentPageField, string> = {
  title: 'Title tag',
  meta_description: 'Meta description',
  json_ld: 'Structured data (JSON-LD)',
};

/** Suggestions that share a passage of the body, an SEO field, or the page as a whole. */
export type SuggestionGroup = Readonly<{
  key: string;
  label: string;
  items: readonly AgentSuggestion[];
}>;

function groupOf(suggestion: AgentSuggestion, body: string): { key: string; label: string } {
  const { anchor, position } = suggestion;
  if (anchor.kind === 'field')
    return { key: `field:${anchor.field}`, label: FIELD_LABEL[anchor.field] };
  if (!position) return { key: 'page', label: 'The whole page' };
  const passage = passageAt(body, position.start);
  return {
    key: `passage:${passage.start}`,
    label: excerpt(body.slice(passage.start, passage.end)) || 'A passage',
  };
}

/**
 * The suggestions grouped by where they are, in the order the server lists
 * them (body spans by position, then SEO fields, then the whole page).
 */
export function groupByPassage(
  suggestions: readonly AgentSuggestion[],
  body: string,
): SuggestionGroup[] {
  const groups = new Map<string, { key: string; label: string; items: AgentSuggestion[] }>();
  for (const suggestion of suggestions) {
    const where = groupOf(suggestion, body);
    const group = groups.get(where.key) ?? { ...where, items: [] };
    group.items.push(suggestion);
    groups.set(where.key, group);
  }
  return [...groups.values()];
}

/** How a highlight reads: blue for an edit ready to apply, amber for one that needs a fact. */
type HighlightTone = 'ready' | 'needs_input';

/** One open suggestion's text in the body, as the editor highlights it. */
export type SuggestionHighlight = Readonly<{
  id: string;
  from: number;
  to: number;
  tone: HighlightTone;
  /** The highlight's accessible name. */
  label: string;
}>;

/**
 * The open body suggestions whose text is in the latest revision. Applied and
 * dismissed ones are not highlighted, so applying one clears its highlight.
 */
export function suggestionHighlights(
  suggestions: readonly AgentSuggestion[],
  labelOf: (suggestion: AgentSuggestion) => string,
): SuggestionHighlight[] {
  return suggestions.flatMap((suggestion) => {
    const { position } = suggestion;
    if (suggestion.status !== 'open' || suggestion.anchor.kind !== 'span' || !position) return [];
    if (position.end <= position.start) return [];
    const tone: HighlightTone = suggestion.readiness === 'needs_input' ? 'needs_input' : 'ready';
    return [
      {
        id: suggestion.id,
        from: position.start,
        to: position.end,
        tone,
        label: labelOf(suggestion),
      },
    ];
  });
}

/**
 * The composer after Ask AI or Add to context: the reference as a Markdown
 * quote, after what the person already wrote, or, in an empty composer, with
 * a starting request under it. It is only text; nothing is sent.
 */
export function withQuotedReference(
  draft: string,
  reference: Readonly<{ quote: string; request: string }>,
): string {
  const quoted = reference.quote
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  if (!draft.trim()) return `${quoted}\n\n${reference.request}`;
  return `${draft.trimEnd()}\n\n${quoted}`;
}
