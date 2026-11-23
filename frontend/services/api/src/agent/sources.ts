import { record } from '../db/json.ts';
import type { WebSource } from '../models/conversation.ts';
import { policy } from '../config.ts';
import { ruleTitle } from '../site-health/reads/rules.ts';
import { agentPolicy } from './contracts.ts';

const LINKED_REF = /\[([^[\]\n]+)\]\(\s*citeladder:\/\/[^)]*\)/giu;
const BARE_REF = /\(?citeladder:\/\/[^\s<>()[\]"']*[^\s<>()[\]"'.,;:!?]\)?/giu;
const UUID_TEXT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(String.raw`(\(?)\b(${UUID_TEXT})\b(\)?)`, 'giu');
const WRITTEN_UUID = new RegExp(String.raw`\b${UUID_TEXT}\b`, 'giu');
const RULE_IDS = [
  ...new Set([
    ...policy.site_health.rule_catalog.map((rule) => rule.rule_id),
    ...policy.content_rules.rules.map((rule) => rule.id),
  ]),
]
  .toSorted((left, right) => right.length - left.length)
  .map((id) => id.replaceAll('.', String.raw`\.`))
  .join('|');
const RULE_ID = String.raw`(?<![\w./-])\x60?(${RULE_IDS})\x60?(?![\w/-]|\.\w)`;
const NAMED_RULE = new RegExp(String.raw`\s*\(\s*(?:(?:rule|check)\s+)?${RULE_ID}\s*\)`, 'giu');
const BARE_RULE = new RegExp(String.raw`(?:\b(?:rule|check)\s+)?${RULE_ID}`, 'giu');
const ANY_REF = new RegExp(String.raw`citeladder:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-|${RULE_ID}`, 'iu');
const ruleLabel = (id: string) => {
  const title = ruleTitle(id);
  return title === id ? (id.split('.').at(-1) ?? id).replaceAll('_', ' ') : title;
};

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
    )
    .replace(NAMED_RULE, '')
    .replace(BARE_RULE, (_match: string, id: string) => ruleLabel(id.toLowerCase()));
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

export function uniqueSources(...groups: Iterable<string>[]) {
  return [...new Set(groups.flatMap((group) => [...group]))];
}

export function uniqueWeb(...groups: readonly WebSource[][]) {
  const pages = new Map<string, string>();
  for (const { url, title } of groups.flat()) if (!pages.has(url)) pages.set(url, title);
  return [...pages].map(([url, title]) => ({ url, title }));
}
