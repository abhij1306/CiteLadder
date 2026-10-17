import type { InternalLinkPage, InternalLinkPlacement } from '@citeladder/contracts/site-health';

import { policy } from '../config.ts';

const limits = policy.internal_links;
const stopWords = new Set<string>(limits.stop_words);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const words = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+/gu)];
type SourcePassages = NonNullable<InternalLinkPage['source_passages']>;

function proseRanges(text: string, headings: string[]) {
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const heading of headings) {
    if (!heading.trim()) continue;
    const index = text.indexOf(heading, cursor);
    if (index < 0) continue;
    ranges.push({ start: cursor, end: index });
    cursor = index + heading.length;
  }
  ranges.push({ start: cursor, end: text.length });
  return ranges;
}

/** A word repeated back to back ("Actions Actions") is a flattened label/value widget, not prose. */
const repeatsAdjacentWord = (tokens: string[]) =>
  tokens.some((token, index) => index > 0 && token === tokens[index - 1]);

function usablePassage(value: string) {
  const tokens = words(value).map((token) => token[0].toLowerCase());
  return (
    value.length <= limits.max_passage_chars &&
    tokens.length >= limits.min_passage_words &&
    /[.!?。！？][\s"'’”)]*$/u.test(value) &&
    !repeatsAdjacentWord(tokens)
  );
}

const contentWords = (anchor: string) =>
  words(anchor).filter((token) => !stopWords.has(token[0].toLowerCase())).length;

/** Exact, bounded source spans; flattened crawl text does not establish DOM paragraphs. */
export function sourcePassages(text: string, headings: string[] = []): SourcePassages {
  const passages: SourcePassages = [];
  // The extractor flattens headings into the text. Split at their observed,
  // ordered occurrences so an H1 and its opening sentence cannot form an anchor.
  for (const range of proseRanges(text, headings)) {
    for (const { segment, index: offset } of segmenter.segment(
      text.slice(range.start, range.end),
    )) {
      const index = range.start + offset;
      if (index + segment.length > limits.max_source_chars) return passages;
      const value = segment.trim();
      if (!usablePassage(value)) continue;
      const start = index + segment.indexOf(value);
      passages.push({ text: value, start, end: start + value.length });
      if (passages.length >= limits.max_passages) return passages;
    }
  }
  return passages;
}

function anchorEnd(
  passage: string,
  tokens: ReturnType<typeof words>,
  start: number,
  targetTerms: Set<string>,
) {
  let end = start;
  for (let next = start + 1; next < tokens.length; next += 1) {
    const token = tokens[next]!;
    const previous = tokens[next - 1]!;
    if (
      next - start >= limits.max_anchor_words ||
      !/^[\s-]+$/u.test(passage.slice(previous.index + previous[0].length, token.index)) ||
      (!targetTerms.has(token[0].toLowerCase()) && !stopWords.has(token[0].toLowerCase()))
    )
      break;
    if (targetTerms.has(token[0].toLowerCase())) end = next;
  }
  return end;
}

/** Candidate phrases share destination vocabulary; JEV decides meaning in context. */
export function sourcePlacements(
  passages: SourcePassages,
  targetTerms: Set<string>,
  targetNames: string[],
): InternalLinkPlacement[] {
  const found: InternalLinkPlacement[] = [];
  // A destination whose whole name is one word ("Pricing") may be linked by that
  // word; any other anchor needs enough words to name the destination, not a topic.
  const names = new Set(
    targetNames.map((name) => name.trim().toLowerCase()).filter((name) => words(name).length === 1),
  );
  const namesTarget = (anchor: string) =>
    contentWords(anchor) >= limits.min_anchor_content_words || names.has(anchor.toLowerCase());
  for (const passage of passages) {
    const tokens = words(passage.text);
    let start = 0;
    while (start < tokens.length) {
      const first = tokens[start]!;
      if (!targetTerms.has(first[0].toLowerCase())) {
        start += 1;
        continue;
      }
      const end = anchorEnd(passage.text, tokens, start, targetTerms);
      const last = tokens[end]!;
      const anchor = passage.text.slice(first.index, last.index + last[0].length);
      if (
        anchor.length >= limits.min_anchor_chars &&
        anchor.length <= limits.max_anchor_chars &&
        namesTarget(anchor)
      )
        found.push({ ...passage, anchor, anchor_start: first.index });
      // The next anchor starts after this one.
      start = end + 1;
    }
  }
  // Longer phrases carry more specific meaning; retain source order for ties.
  return found
    .toSorted((a, b) => words(b.anchor).length - words(a.anchor).length)
    .slice(0, limits.max_placements);
}
