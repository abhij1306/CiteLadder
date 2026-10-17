/**
 * Answer perception reads: the selection summary, its quote pages and the
 * per-entity perception of one execution.
 *
 * Projections over persisted `answer_perceptions` / `entity_sentiments` and
 * the deterministic entity assessments; nothing is classified, called or
 * repaired here. In a perceived audit, a named entity without a perception
 * row is pending; an audit admitted without perception contributes nothing.
 */
import { z } from 'zod';
import {
  perceptionLabelSchema,
  type ExecutionPerception,
  type PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { chunked, groupBy } from '../lists.ts';
import { frozenPerceptionVersions } from '../perception/admission.ts';
import {
  classifiedQuotes,
  mentionStatus,
  perceptionSummary,
  persistedOutcomeSchema,
  quoteOrder,
  type Mention,
  type PerceptionAnswer,
} from '../perception/metrics.ts';
import { isNamed } from '../perception/passages.ts';
import { compareText } from '../text-order.ts';
import { scopedSelection } from './dashboard.ts';
import { citationsByAnalysis, evidenceScope, observedAt, type RunSelection } from './selection.ts';

const visibility = policy.visibility;
const QUOTES_CURSOR_SCOPE = 'visibility.perception.quotes';

const assessmentsSchema = z
  .array(
    z.object({
      entity_id: z.string(),
      entity_name: z.string(),
      entity_kind: z.string(),
      state: z.string(),
    }),
  )
  .catch([]);
type Assessment = z.infer<typeof assessmentsSchema>[number];
const aspectsSchema = z
  .array(
    z.object({
      theme: z.string(),
      polarity: z.enum(['positive', 'negative']),
      quote: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    }),
  )
  .catch([]);
const entityRowSchema = z.object({
  label: perceptionLabelSchema,
  confidence: z.number().nullable(),
  low_confidence: z.boolean(),
  aspects: z.unknown(),
});

type EntityRow = z.infer<typeof entityRowSchema>;
type Perceived = {
  perception: z.infer<typeof persistedOutcomeSchema>;
  entities: Map<string, EntityRow>;
};

/** Each analysis's perception row at the extractor version its audit froze (`wanted`). */
export async function perceptionRows(
  db: Database,
  workspaceId: string,
  wanted: ReadonlyMap<string, string>,
) {
  if (!wanted.size) return [];
  return (
    await chunked([...wanted.keys()], (ids) =>
      db
        .selectFrom('answer_perceptions')
        .select(['id', 'analysis_id', 'extractor_version', 'outcome', 'outcome_reason'])
        .where('workspace_id', '=', workspaceId)
        .where('analysis_id', 'in', ids)
        .execute(),
    )
  ).filter((row) => wanted.get(row.analysis_id) === row.extractor_version);
}

/** Each analysis's perception at its extractor version, with its entity rows. */
async function perceptionsOf(
  db: Database,
  workspaceId: string,
  wanted: ReadonlyMap<string, string>,
): Promise<Map<string, Perceived>> {
  const perceptions = await perceptionRows(db, workspaceId, wanted);
  if (!perceptions.length) return new Map();
  const entities = groupBy(
    await chunked(
      perceptions.map((row) => row.id),
      (ids) =>
        db
          .selectFrom('entity_sentiments')
          .select([
            'perception_id',
            'entity_id',
            'label',
            'confidence',
            'low_confidence',
            'aspects',
          ])
          .where('workspace_id', '=', workspaceId)
          .where('perception_id', 'in', ids)
          .execute(),
    ),
    (row) => row.perception_id,
  );
  return new Map(
    perceptions.map((row) => [
      row.analysis_id,
      {
        perception: persistedOutcomeSchema.parse(row),
        entities: new Map(
          (entities.get(row.id) ?? []).map((entity) => [
            entity.entity_id,
            entityRowSchema.parse(entity),
          ]),
        ),
      },
    ]),
  );
}

/** The named entities of one analysis as mentions, with the entity row behind each. */
function mentionsOf(assessments: readonly Assessment[], perceived: Perceived | undefined) {
  return assessments
    .filter((row) => isNamed(row.state))
    .map((row) => {
      const entity = perceived?.entities.get(row.entity_id);
      const status = mentionStatus(perceived?.perception, entity);
      const mention: Mention = {
        entity: row.entity_name,
        isBrand: row.entity_kind === 'brand',
        status,
        aspects: status.kind === 'classified' ? aspectsSchema.parse(entity?.aspects) : [],
      };
      return { mention, entity };
    });
}

/** The selection's perceived answers; citations only when the caller reads drivers. */
async function selectionAnswers(
  db: Database,
  selection: RunSelection,
  options: { citations: boolean },
) {
  const scoped = await scopedSelection(db, selection);
  const rows = (
    await evidenceScope(db, scoped)
      .where('audit.audit_scope', '=', visibility.brand_audit_scope)
      .select([
        'ra.id',
        'ra.audit_id',
        'ra.task_id',
        'ra.logical_engine',
        'ra.entity_assessments',
        'audit.configuration',
        'snapshot.text as prompt',
        'snapshot.theme as topic',
        utcTextOf(observedAt).as('observed_at'),
      ])
      .execute()
  ).flatMap((row) => {
    const versions = frozenPerceptionVersions(row.configuration);
    return versions ? [{ ...row, versions }] : [];
  });
  const ids = rows.map((row) => row.id);
  const [perceived, citations] = await Promise.all([
    perceptionsOf(
      db,
      scoped.workspaceId,
      new Map(rows.map((row) => [row.id, row.versions.extractor_version])),
    ),
    options.citations
      ? citationsByAnalysis(db, scoped.workspaceId, ids)
      : new Map<string, { domain: string; url: string }[]>(),
  ]);
  const answers = rows.map((row): PerceptionAnswer => {
    const assessments = assessmentsSchema.parse(row.entity_assessments);
    return {
      auditId: row.audit_id,
      executionId: row.task_id,
      observedAt: wireUtc(row.observed_at),
      logicalEngine: row.logical_engine,
      prompt: row.prompt,
      topic: row.topic || 'Untagged',
      versions: {
        extractor: row.versions.extractor_version,
        template: row.versions.template_version,
        metrics: row.versions.metrics_version,
      },
      mentions: mentionsOf(assessments, perceived.get(row.id)).map(({ mention }) => mention),
      brandRecommendation: assessments.find((row) => row.entity_kind === 'brand')?.state ?? null,
      citations: (citations.get(row.id) ?? []).map(({ domain, url }) => ({ domain, url })),
    };
  });
  return { answers, auditIds: [...new Set(rows.map((row) => row.audit_id))].sort(compareText) };
}

export async function getPerception(
  db: Database,
  selection: RunSelection,
): Promise<PerceptionResponse> {
  const { answers, auditIds } = await selectionAnswers(db, selection, { citations: true });
  return { ...perceptionSummary(answers, policy.perception), source_audit_ids: auditIds };
}

/** The decoded cursor position; a malformed one is refused, never read as the start. */
function cursorPosition(cursor: string, fingerprint: Record<string, unknown>) {
  const [observed_at, execution_id, entity, ordinal] = decodeKeysetCursor(
    cursor,
    QUOTES_CURSOR_SCOPE,
    fingerprint,
  );
  const offset = Number(ordinal);
  if (observed_at === undefined || execution_id === undefined || entity === undefined)
    throw new InvalidCursorError('invalid cursor');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new InvalidCursorError('invalid cursor');
  return { observed_at, execution_id, entity, ordinal: offset };
}

export async function getPerceptionQuotes(
  db: Database,
  selection: RunSelection,
  filters: {
    entity: string | null;
    theme: string | null;
    polarity: 'positive' | 'negative' | null;
    cursor: string | null;
    limit: number;
  },
) {
  const fingerprint = {
    selection: JSON.stringify(selection),
    entity: filters.entity,
    theme: filters.theme,
    polarity: filters.polarity,
  };
  const after = filters.cursor ? cursorPosition(filters.cursor, fingerprint) : null;
  const { answers } = await selectionAnswers(db, selection, { citations: false });
  const quotes = classifiedQuotes(
    answers,
    (mention) => filters.entity === null || mention.entity === filters.entity,
  ).filter(
    (quote) =>
      (filters.theme === null || quote.theme === filters.theme) &&
      (filters.polarity === null || quote.polarity === filters.polarity) &&
      (after === null || quoteOrder(quote, after) > 0),
  );
  const page = quotes.slice(0, filters.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ ordinal: _ordinal, ...quote }) => quote),
    next_cursor:
      last && quotes.length > filters.limit
        ? encodeKeysetCursor(QUOTES_CURSOR_SCOPE, fingerprint, [
            last.observed_at,
            last.execution_id,
            last.entity,
            String(last.ordinal),
          ])
        : null,
  };
}

/** One execution's per-entity perception; empty for an audit admitted without perception. */
export async function executionPerception(
  db: Database,
  input: {
    workspaceId: string;
    analysisId: string;
    assessments: unknown;
    configuration: unknown;
  },
): Promise<ExecutionPerception[]> {
  const versions = frozenPerceptionVersions(input.configuration);
  if (!versions) return [];
  const perceived = await perceptionsOf(
    db,
    input.workspaceId,
    new Map([[input.analysisId, versions.extractor_version]]),
  );
  return mentionsOf(
    assessmentsSchema.parse(input.assessments),
    perceived.get(input.analysisId),
  ).map(({ mention, entity }) => {
    const { status } = mention;
    const labelled = status.kind === 'classified' || status.kind === 'low_confidence';
    return {
      entity: mention.entity,
      is_brand: mention.isBrand,
      state: status.kind,
      reason: status.kind === 'unavailable' ? status.reason : null,
      label: labelled ? (entity?.label ?? null) : null,
      confidence: entity?.confidence ?? null,
      extractor_version: versions.extractor_version,
      template_version: versions.template_version,
      aspects: mention.aspects,
    };
  });
}
