/**
 * A Markdown output as the sections a reader works on: each starts at a
 * level 1–3 heading and runs to the next one; text before the first heading
 * is an untitled introduction. Headings inside fenced code are content, not
 * section breaks. Joining the sections back reproduces the body exactly.
 */

export type OutputSection = { heading: string | null; text: string; start: number };

const HEADING = /^#{1,3}\s+(\S.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

function headingText(line: string): string | null {
  const match = HEADING.exec(line);
  const heading = match?.[1];
  if (heading === undefined) return null;
  let title = heading.trimEnd();
  let end = title.length;
  while (end > 0 && title[end - 1] === '#') end--;
  title = title.slice(0, end).trimEnd();
  return title;
}

function withoutTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '\n') end--;
  return text.slice(0, end);
}

function nextFence(fence: string | null, marker: string): string | null {
  if (fence === null) return marker;
  return marker.startsWith(fence) ? null : fence;
}

export function splitSections(body: string): OutputSection[] {
  const sections: OutputSection[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  let fence: string | null = null;
  let offset = 0;
  let start = 0;
  for (const line of body.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const marker = FENCE.exec(line)?.[1];
    if (marker) fence = nextFence(fence, marker);
    const heading = fence === null && !marker ? headingText(line) : null;
    if (heading) {
      const blankIntro = current.heading === null && !current.lines.some((item) => item.trim());
      // Leading blank lines belong to the first titled section.
      const carried = blankIntro ? current.lines : [];
      if (!blankIntro) {
        sections.push({ heading: current.heading, text: current.lines.join('\n'), start });
        start = lineStart;
      }
      current = { heading, lines: [...carried, line] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push({ heading: current.heading, text: current.lines.join('\n'), start });
  return sections;
}

/** The body with one section's text replaced and every other section kept. */
export function replaceSection(body: string, index: number, text: string): string {
  const sections = splitSections(body);
  if (index < 0 || index >= sections.length) return body;
  return sections
    .map((section, position) => {
      if (position !== index) return section.text;
      // Keep the blank lines that separated this section from the next.
      const trailing = section.text.slice(withoutTrailingNewlines(section.text).length);
      return withoutTrailingNewlines(text) + trailing;
    })
    .join('\n');
}
