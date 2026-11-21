import { factTopicSchema, type FactTopic } from '@citeladder/contracts/fact-checking';
import type { BrandFactImportRequest } from '@citeladder/contracts/project-requests';

import { tokenizeCsv } from '@/lib/prompts/csv';
import { TOPIC_LABELS } from '@/lib/visibility/accuracy';

export const FACT_CSV_COLUMNS = ['topic', 'statement', 'source_url'] as const;

export const FACT_CSV_SAMPLE_ROWS: readonly (readonly [string, string, string])[] = [
  ['pricing', 'The Pro plan costs $59 a month.', 'https://example.com/pricing'],
  ['integrations', 'Integrates with Slack and HubSpot.', ''],
  ['company', 'Founded in 2019.', ''],
];

const HEADER_KEYS = {
  topic: new Set(['topic']),
  statement: new Set(['statement', 'fact']),
  source_url: new Set(['source_url', 'source url', 'source', 'url']),
} as const;

type FactImportRow = BrandFactImportRequest['rows'][number];

export type ParsedFactRow = { line: number; input: FactImportRow; errors: string[] };
export type ParsedFactCsv = { rows: ParsedFactRow[]; errors: string[] };

function topicOf(value: string): FactTopic | null {
  const wanted = value.trim().toLowerCase();
  const byKey = factTopicSchema.safeParse(wanted);
  if (byKey.success) return byKey.data;
  return (
    factTopicSchema.options.find((topic) => TOPIC_LABELS[topic].toLowerCase() === wanted) ?? null
  );
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function parseRow(
  cells: string[],
  columns: Record<keyof typeof HEADER_KEYS, number>,
  line: number,
) {
  const cell = (index: number) => (index >= 0 ? (cells[index] ?? '').trim() : '');
  const rawTopic = cell(columns.topic);
  const topic = topicOf(rawTopic);
  const statement = cell(columns.statement);
  const sourceUrl = cell(columns.source_url);
  const errors: string[] = [];
  if (!topic)
    errors.push(
      rawTopic
        ? `Unknown topic "${rawTopic}". Use one of: ${factTopicSchema.options.join(', ')}.`
        : 'Topic is required.',
    );
  if (!statement) errors.push('Statement is required.');
  if (sourceUrl && !isHttpUrl(sourceUrl))
    errors.push('Source URL must be an http or https address.');
  return {
    line,
    input: { topic: topic ?? rawTopic, statement, source_url: sourceUrl || null },
    errors,
  };
}

export function parseFactCsv(raw: string, maxRows: number | null): ParsedFactCsv {
  const [header, ...data] = tokenizeCsv(raw);
  if (!header) return { rows: [], errors: ['The file is empty.'] };
  const find = (keys: ReadonlySet<string>) =>
    header.findIndex((cell) => keys.has(cell.trim().toLowerCase()));
  const columns = {
    topic: find(HEADER_KEYS.topic),
    statement: find(HEADER_KEYS.statement),
    source_url: find(HEADER_KEYS.source_url),
  };
  if (columns.topic < 0 || columns.statement < 0)
    return { rows: [], errors: ['The first row must name the topic and statement columns.'] };
  const rows = data.map((cells, index) => parseRow(cells, columns, index + 1));
  if (!rows.length) return { rows, errors: ['No data rows were found.'] };
  if (maxRows !== null && rows.length > maxRows)
    return {
      rows,
      errors: [
        `The file has ${rows.length} rows; import up to ${maxRows} at a time by splitting it.`,
      ],
    };
  return { rows, errors: [] };
}
