import { z } from 'zod';
import {
  perceptionLabelSchema,
  type ExecutionPerception,
  type PerceptionAttribute,
  type PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

import { frozenComparisonKey } from '../analysis/comparison.ts';
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
  entityScores,
  mentionStatus,
  perceptionSummary,
  perceptionTrend,
  persistedOutcomeSchema,
  quoteOrder,
  type Mention,
  type NamedAspect,
  type PerceptionAnswer,
} from '../perception/metrics.ts';
import { isNamed } from '../perception/passages.ts';
import { compareText } from '../text-order.ts';
import { applyIdentities, brandIdentities } from './brand-identities.ts';
import { scopedSelection } from './dashboard.ts';
import { periodTrendSelection } from './runs.ts';
import {
  citationsByAnalysis,
  evidenceScope,
  observedAt,
  perceptionCohorts,
  selectedRuns,
  TrendQueryError,
  type RunSelection,
} from './selection.ts';

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
      theme_id: z.string().nullable().catch(null),
      attribute: z.string().nullable().optional(),
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
  model_omitted: z.boolean(),
  aspects: z.unknown(),
});

type EntityRow = Omit<z.infer<typeof entityRowSchema>, 'aspects'> & { aspects: NamedAspect[] };
type Perceived = {
  perception: z.infer<typeof persistedOutcomeSchema>;
  entities: Map<string, EntityRow>;
};

async function themeNames(db: Database, workspaceId: string, projectIds: readonly string[]) {
  const rows = await db
    .selectFrom('project_themes')
    .select(['id', 'name'])
    .where('workspace_id', '=', workspaceId)
    .where('project_id', 'in', projectIds)
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

function attributeOf(attribute: string | null | undefined): PerceptionAttribute {
  if (attribute === undefined) return { kind: 'not_labelled' };
  return attribute === null ? { kind: 'not_found' } : { kind: 'labelled', name: attribute };
}

function entityRow(row: unknown, names: ReadonlyMap<string, string>): EntityRow {
  const entity = entityRowSchema.parse(row);
  const fallback = policy.perception.project_themes.fallback;
  return {
    ...entity,
    aspects: aspectsSchema.parse(entity.aspects).map(({ theme_id, attribute, ...aspect }) => ({
      ...aspect,
      theme: (theme_id === null ? undefined : names.get(theme_id)) ?? fallback,
      attribute: attributeOf(attribute),
    })),
  };
}

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
        .select([
          'id',
          'project_id',
          'analysis_id',
          'extractor_version',
          'outcome',
          'outcome_reason',
        ])
        .where('workspace_id', '=', workspaceId)
        .where('analysis_id', 'in', ids)
        .execute(),
    )
  ).filter((row) => wanted.get(row.analysis_id) === row.extractor_version);
}

async function perceptionsOf(
  db: Database,
  workspaceId: string,
  wanted: ReadonlyMap<string, string>,
): Promise<Map<string, Perceived>> {
  const perceptions = await perceptionRows(db, workspaceId, wanted);
  if (!perceptions.length) return new Map();
  const names = await themeNames(db, workspaceId, [
    ...new Set(perceptions.map((row) => row.project_id)),
  ]);
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
            'model_omitted',
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
            entityRow(entity, names),
          ]),
        ),
      },
    ]),
  );
}

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
        aspects: status.kind === 'classified' ? (entity?.aspects ?? []) : [],
      };
      return { mention, entity };
    });
}

async function selectionAnswers(
  db: Database,
  selection: RunSelection,
  options: { citations: boolean; brandQuestions?: boolean },
) {
  const scoped = await scopedSelection(db, selection);
  const cohorts = options.brandQuestions ? perceptionCohorts(scoped.cohort) : undefined;
  const selected = await evidenceScope(db, scoped, cohorts)
    .select([
      'ra.id',
      'ra.audit_id',
      'ra.task_id',
      'ra.logical_engine',
      'ra.entity_assessments',
      'audit.configuration',
      'snapshot.text as prompt',
      'snapshot.theme as topic',
      'snapshot.topic_id',
      utcTextOf(observedAt).as('observed_at'),
    ])
    .execute();
  const rows = selected.flatMap((row) => {
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
  const answers = rows.map((row): PerceptionAnswer & { topicId: string | null } => {
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
        model: row.versions.model,
      },
      comparisonKey: frozenComparisonKey(row.configuration, scoped.logicalEngine),
      mentions: mentionsOf(assessments, perceived.get(row.id)).map(({ mention }) => mention),
      brandRecommendation: assessments.find((row) => row.entity_kind === 'brand')?.state ?? null,
      topicId: row.topic_id,
      citations: (citations.get(row.id) ?? []).map(({ domain, url }) => ({ domain, url })),
    };
  });
  return {
    answers,
    auditIds: [...new Set(rows.map((row) => row.audit_id))].sort(compareText),
    partial: rows.length < selected.length,
    unperceived: new Set(
      selected.filter((row) => !frozenPerceptionVersions(row.configuration)).map((r) => r.audit_id),
    ),
  };
}

async function windowSelection(db: Database, selection: RunSelection): Promise<RunSelection> {
  const scoped = await scopedSelection(db, selection);
  if (scoped.auditId !== null || scoped.auditIds?.length) return scoped;
  const runs = await selectedRuns(db, scoped)
    .select('audit.id')
    .orderBy(observedAt, 'desc')
    .orderBy('audit.id', 'desc')
    .limit(policy.visibility.selection_max_runs + 1)
    .execute();
  if (runs.length > policy.visibility.selection_max_runs)
    throw new TrendQueryError(
      `Select a narrower period: at most ${policy.visibility.selection_max_runs} runs per selection`,
    );
  return { ...scoped, auditIds: runs.map((run) => run.id) };
}

export async function getPerception(
  db: Database,
  selection: RunSelection,
): Promise<PerceptionResponse> {
  const scoped = await windowSelection(db, selection);
  const [{ answers, auditIds }, period] = await Promise.all([
    selectionAnswers(db, scoped, { citations: true, brandQuestions: true }),
    periodTrendSelection(db, scoped),
  ]);
  const summary = perceptionSummary(answers, policy.perception);
  applyIdentities(summary.entities, await brandIdentities(db, scoped));
  const trend = period
    ? perceptionTrend(
        (await selectionAnswers(db, period, { citations: false, brandQuestions: true })).answers,
      )
    : summary.trend;
  return { ...summary, trend, source_audit_ids: auditIds };
}

export async function perceivedAnswers(db: Database, selection: RunSelection) {
  const { answers, partial } = await selectionAnswers(db, selection, { citations: false });
  return partial ? null : answers;
}

export async function groupedSentiments(
  db: Database,
  selection: RunSelection,
  groups: readonly (readonly string[])[],
) {
  const { answers, unperceived } = await selectionAnswers(db, selection, { citations: false });
  const byAudit = groupBy(answers, (answer) => answer.auditId);
  return groups.map((auditIds) =>
    auditIds.some((id) => unperceived.has(id))
      ? null
      : sentimentsOf(auditIds.flatMap((id) => byAudit.get(id) ?? [])),
  );
}

export function sentimentsOf(answers: readonly PerceptionAnswer[]) {
  return entityScores(answers, policy.perception).map(({ name, is_brand, score, coverage }) => ({
    name,
    is_brand,
    sentiment: {
      mentions: coverage.mentions,
      classified: score.classified,
      positive: score.positive,
      negative: score.negative,
      net_sentiment: score.net_sentiment,
    },
  }));
}

export async function brandMentionsByAudit(
  db: Database,
  input: {
    workspaceId: string;
    audits: readonly { id: string; configuration: unknown }[];
    analyses: readonly { id: string; audit_id: string; entity_assessments: unknown }[];
  },
): Promise<Map<string, Map<string, Mention[]>>> {
  const extractor = new Map(
    input.audits.flatMap((audit) => {
      const versions = frozenPerceptionVersions(audit.configuration);
      return versions ? [[audit.id, versions.extractor_version] as const] : [];
    }),
  );
  const analyses = input.analyses.flatMap((row) => {
    const version = extractor.get(row.audit_id);
    return version ? [{ ...row, version }] : [];
  });
  const perceived = await perceptionsOf(
    db,
    input.workspaceId,
    new Map(analyses.map((row) => [row.id, row.version])),
  );
  const byAudit = groupBy(analyses, (row) => row.audit_id);
  return new Map(
    [...extractor.keys()].map((auditId) => [
      auditId,
      new Map(
        (byAudit.get(auditId) ?? []).map((row) => [
          row.id,
          mentionsOf(assessmentsSchema.parse(row.entity_assessments), perceived.get(row.id))
            .map(({ mention }) => mention)
            .filter((mention) => mention.isBrand),
        ]),
      ),
    ]),
  );
}

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
  const { answers } = await selectionAnswers(db, await windowSelection(db, selection), {
    citations: false,
    brandQuestions: true,
  });
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
