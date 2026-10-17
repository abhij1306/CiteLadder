/** Packaged model input parsing and deployment directory resolution. */
import { fileURLToPath } from 'node:url';

export function resolveSkillsDirectory(configured: string): string {
  return configured || fileURLToPath(new URL('../../assets/agent-skills/', import.meta.url));
}

/**
 * Follows Markdown fenced blocks line by line: `marker` is a fence line, and
 * `fenced` is true inside a block. A fence line with an info string never
 * closes one.
 */
export function fenceTracker() {
  let fence: string | null = null;
  return (line: string) => {
    const [opening = '', fenceRun] = /^ {0,3}(`{3,}|~{3,})/u.exec(line) ?? [];
    const info = line.slice(opening.length);
    // A line terminator in the rest (e.g. a CRLF `\r`) means the line is not a fence.
    const run = /[\n\r\p{Zl}\p{Zp}]/u.test(info) ? undefined : fenceRun;
    if (
      run !== undefined &&
      (!fence || (run.startsWith(fence.charAt(0)) && run.length >= fence.length && !info.trim()))
    )
      fence = fence ? null : run;
    return { marker: run !== undefined, fenced: fence !== null };
  };
}

function formatSections(body: string): string[] {
  const sections = [''];
  const fences = fenceTracker();
  for (const line of body.split('\n')) {
    const { marker, fenced } = fences(line);
    if (!fenced && !marker && /^ {0,3}##(?:[ \t]|$)/u.test(line)) sections.push('');
    sections[sections.length - 1] += line + '\n';
  }
  return sections;
}

export type ContentFormat = { id: string; label: string; body: string; longForm: boolean };

export function parseContentFormats(body: string) {
  const [preamble = '', ...sections] = formatSections(body);
  const formats = new Map<string, ContentFormat>();
  for (const section of sections) {
    // `[long-form]` marks formats whose drafts start from an approved outline.
    const [heading, id, label, longForm] =
      /^## ([a-z_]+) — (.+?)( \[long-form\])?\n/u.exec(section) ?? [];
    if (heading === undefined || id === undefined || label === undefined || formats.has(id))
      throw new TypeError('Invalid content format');
    const text = section.slice(heading.length).trim();
    if (!text) throw new TypeError('Empty content format');
    formats.set(id, {
      id,
      label: label.trim(),
      body: text,
      longForm: Boolean(longForm),
    });
  }
  return { formatPreamble: preamble.slice(preamble.indexOf('\n') + 1).trim(), formats };
}
