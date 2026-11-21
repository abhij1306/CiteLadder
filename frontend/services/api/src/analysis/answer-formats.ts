import {
  answerFormatSchema,
  type AnswerFormat,
  type AnswerFormats,
} from '@citeladder/contracts/audits';
import { z } from 'zod';
import { answerEvidence } from '../config/answer-evidence.ts';
import { surfaceKindOf } from '../config/providers.ts';
import { record } from '../db/json.ts';
import { onlyOf } from '../lists.ts';
import { citationIdentity } from '../source-pages/identity.ts';

const FORMATS = answerFormatSchema.options;
const FORMAT_OF = new Map<string, AnswerFormat>(
  FORMATS.flatMap((format) =>
    answerEvidence.format_markers[format].map((type): [string, AnswerFormat] => [type, format]),
  ),
);
const ADS = new Set<string>(answerEvidence.ad_item_types);
const LINK = /(?<!!)\[[^[\]]*\]\((https?:\/\/[^\s)]+)/gu;

export type AnswerFormatColumns = {
  answer_format_state: 'observed' | 'unavailable' | 'not_applicable';
  answer_formats: AnswerFormat[] | null;
  in_text_link_count: number | null;
};

const items = (node: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(node.items)
    ? node.items
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map(record)
    : [];

function itemTypes(node: Record<string, unknown>, found: Set<string>, depth = 0): void {
  if (depth > answerEvidence.max_item_depth) return;
  for (const item of items(node)) {
    const type = typeof item.type === 'string' ? item.type : '';
    if (ADS.has(type)) continue;
    found.add(type);
    itemTypes(item, found, depth + 1);
  }
}

function inTextLinks(page: Record<string, unknown>): number {
  const urls = new Set<string>();
  for (const item of items(page)) {
    const type = typeof item.type === 'string' ? item.type : '';
    if (ADS.has(type) || FORMAT_OF.has(type) || typeof item.markdown !== 'string') continue;
    for (const [, target = ''] of item.markdown.matchAll(LINK)) {
      const url = citationIdentity(target).canonical_url;
      if (url) urls.add(url);
    }
  }
  return urls.size;
}

export function answerFormatColumns(input: {
  logicalEngine: string;
  providerMetadata: unknown;
}): AnswerFormatColumns {
  if (surfaceKindOf(input.logicalEngine) !== 'llm_scraper')
    return {
      answer_format_state: 'not_applicable',
      answer_formats: null,
      in_text_link_count: null,
    };
  const tasks = record(record(input.providerMetadata).raw_response).tasks;
  const task = Array.isArray(tasks) ? onlyOf(tasks) : undefined;
  const results = task && typeof task === 'object' ? record(task).result : undefined;
  const page = Array.isArray(results) ? onlyOf(results) : undefined;
  if (!page || typeof page !== 'object' || !Array.isArray(record(page).items))
    return { answer_format_state: 'unavailable', answer_formats: null, in_text_link_count: null };
  const found = new Set<string>();
  itemTypes(record(page), found);
  const formats = new Set([...found].flatMap((type) => FORMAT_OF.get(type) ?? []));
  return {
    answer_format_state: 'observed',
    answer_formats: FORMATS.filter((format) => formats.has(format)),
    in_text_link_count: inTextLinks(record(page)),
  };
}

export function storedAnswerFormats(row: {
  answer_format_state: string;
  answer_formats: string[] | null;
  in_text_link_count: number | null;
}): AnswerFormats {
  switch (row.answer_format_state) {
    case 'observed':
      return {
        kind: 'observed',
        formats: z.array(answerFormatSchema).parse(row.answer_formats),
        in_text_links: z.number().int().nonnegative().parse(row.in_text_link_count),
      };
    case 'not_applicable':
      return { kind: 'not_applicable' };
    case 'unavailable':
      return { kind: 'unavailable' };
    default:
      throw new Error(`Unknown answer format state: ${row.answer_format_state}`);
  }
}
