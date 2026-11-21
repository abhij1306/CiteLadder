import { factTopicSchema, type FactTopic } from '@citeladder/contracts/fact-checking';

import type { FactCheckPolicy, PerceptionPolicy } from '../config/perception.ts';
import { idsByName, nameKey } from '../projects/themes.ts';
import type { ExtractedClaim, Label, PerceptionOutput } from './model.ts';
import type { PerceptionPackage, Span } from './passages.ts';

export type VerifiedAspect = {
  theme_id: string | null;
  polarity: 'positive' | 'negative';
  quote: string;
  start: number;
  end: number;
};

export type EntitySentiment = {
  entity_id: string;
  entity_name: string;
  entity_kind: 'brand' | 'competitor';
  label: Label;
  confidence: number | null;
  low_confidence: boolean;
  model_omitted: boolean;
  passage_spans: Span[];
  aspects: VerifiedAspect[];
};

export type DropReason =
  | 'unknown_entity'
  | 'duplicate_entity'
  | 'missing_entity'
  | 'quote_not_found'
  | 'aspect_limit'
  | 'theme_other'
  | 'claim_no_brand'
  | 'claim_quote_not_found'
  | 'claim_off_topic'
  | 'claim_duplicate'
  | 'claim_limit';

function collapsed(text: string) {
  let out = '';
  const source: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (/\s/u.test(char)) {
      if (out.endsWith(' ')) continue;
      out += ' ';
    } else out += char;
    source.push(index);
  }
  return { out, source };
}

export function locateQuote(quote: string, spans: readonly Span[]) {
  const wanted = quote.replaceAll(/\s+/gu, ' ').trim();
  if (!wanted) return null;
  for (const span of spans) {
    const { out, source } = collapsed(span.text);
    const at = out.indexOf(wanted);
    if (at === -1) continue;
    const from = source[at]!;
    const to = source[at + wanted.length - 1]! + 1;
    const start = span.start + Array.from(span.text.slice(0, from)).length;
    const text = span.text.slice(from, to);
    return { start, end: start + Array.from(text).length, text };
  }
  return null;
}

function verifiedAspects(
  aspects: PerceptionOutput['entities'][number]['aspects'],
  spans: readonly Span[],
  themes: { ids: ReadonlyMap<string, string>; fallback: string },
  drop: (reason: DropReason) => void,
): VerifiedAspect[] {
  return aspects.flatMap((aspect) => {
    const found = locateQuote(aspect.quote, spans);
    if (!found) {
      drop('quote_not_found');
      return [];
    }
    const key = nameKey(aspect.theme);
    const themeId = themes.ids.get(key) ?? null;
    if (themeId === null && key !== themes.fallback) drop('theme_other');
    return [
      {
        theme_id: themeId,
        polarity: aspect.polarity,
        quote: found.text,
        start: found.start,
        end: found.end,
      },
    ];
  });
}

export function validateOutput(
  pkg: PerceptionPackage,
  output: PerceptionOutput,
  policy: Pick<PerceptionPolicy, 'min_confidence' | 'max_aspects_per_entity' | 'project_themes'>,
) {
  const drops: Partial<Record<DropReason, number>> = {};
  const drop = (reason: DropReason, count = 1) => {
    if (count > 0) drops[reason] = (drops[reason] ?? 0) + count;
  };
  const sent = new Map(pkg.entities.map((entity) => [entity.entity_id, entity]));
  const themes = {
    ids: idsByName(pkg.themes),
    fallback: nameKey(policy.project_themes.fallback),
  };
  const results = new Map<string, EntitySentiment>();
  for (const row of output.entities) {
    const entity = sent.get(row.entity_id);
    if (!entity) {
      drop('unknown_entity');
      continue;
    }
    if (results.has(row.entity_id)) {
      drop('duplicate_entity');
      continue;
    }
    drop('aspect_limit', row.aspects.length - policy.max_aspects_per_entity);
    const aspects = verifiedAspects(
      row.aspects.slice(0, policy.max_aspects_per_entity),
      entity.spans,
      themes,
      drop,
    );
    results.set(row.entity_id, {
      entity_id: entity.entity_id,
      entity_name: entity.name,
      entity_kind: entity.kind,
      label: row.label,
      confidence: row.confidence,
      low_confidence: row.confidence < policy.min_confidence,
      model_omitted: false,
      passage_spans: entity.spans,
      aspects,
    });
  }
  const entities = pkg.entities.map((entity): EntitySentiment => {
    const result = results.get(entity.entity_id);
    if (result) return result;
    drop('missing_entity');
    return {
      entity_id: entity.entity_id,
      entity_name: entity.name,
      entity_kind: entity.kind,
      label: 'not_assessable',
      confidence: null,
      low_confidence: false,
      model_omitted: true,
      passage_spans: entity.spans,
      aspects: [],
    };
  });
  return { entities, drops };
}

export type VerifiedClaim = {
  ordinal: number;
  topic: FactTopic;
  claim: string;
  quote: string;
  start: number;
  end: number;
  confidence: number;
  low_confidence: boolean;
};

export function validateClaims(
  pkg: PerceptionPackage,
  claims: readonly ExtractedClaim[],
  policy: Pick<
    FactCheckPolicy,
    'topics' | 'max_claims_per_answer' | 'min_confidence' | 'statement_max_chars'
  >,
): { claims: VerifiedClaim[]; drops: Partial<Record<DropReason, number>> } {
  const drops: Partial<Record<DropReason, number>> = {};
  const drop = (reason: DropReason, count = 1) => {
    if (count > 0) drops[reason] = (drops[reason] ?? 0) + count;
  };
  const brand = pkg.entities.find((entity) => entity.kind === 'brand');
  if (!brand) {
    drop('claim_no_brand', claims.length);
    return { claims: [], drops };
  }
  const topics = new Set<string>(policy.topics);
  const seen = new Set<string>();
  const verified: VerifiedClaim[] = [];
  for (const row of claims) {
    const topic = factTopicSchema.safeParse(row.topic);
    if (!topic.success || !topics.has(topic.data)) {
      drop('claim_off_topic');
      continue;
    }
    const found = locateQuote(row.quote, brand.spans);
    if (!found) {
      drop('claim_quote_not_found');
      continue;
    }
    const key = `${found.start}:${found.end}:${topic.data}`;
    if (seen.has(key)) {
      drop('claim_duplicate');
      continue;
    }
    if (verified.length >= policy.max_claims_per_answer) {
      drop('claim_limit');
      continue;
    }
    seen.add(key);
    const claim = row.claim.trim() || found.text;
    verified.push({
      ordinal: verified.length,
      topic: topic.data,
      claim: Array.from(claim).slice(0, policy.statement_max_chars).join(''),
      quote: found.text,
      start: found.start,
      end: found.end,
      confidence: row.confidence,
      low_confidence: row.confidence < policy.min_confidence,
    });
  }
  return { claims: verified, drops };
}
