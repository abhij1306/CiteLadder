/**
 * Fact-check reads: the selection's accuracy summary, its claim pages and the
 * claims of one execution.
 *
 * Projections over persisted `answer_claims`, `fact_verifications`,
 * `claim_verdicts` and the frozen fact revisions; nothing is extracted,
 * verified, called or repaired here. Only audits that froze a fact-check
 * contribute.
 */
import {
  claimVerdictSchema,
  factTopicSchema,
  type AccuracyResponse,
  type ExecutionClaim,
} from '@citeladder/contracts/fact-checking';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { chunked, groupBy } from '../lists.ts';
import {
  checkedTopics,
  frozenFactCheck,
  frozenPerceptionVersions,
  type FrozenFactCheck,
  type PerceptionVersions,
} from '../perception/admission.ts';
import {
  accuracySummary,
  claimOrder,
  claimStatus,
  claimView,
  positionedClaims,
  unavailableReason,
  type ClaimRow,
  type Extraction,
  type FactAnswer,
  type FactRef,
} from '../perception/fact-metrics.ts';
import { isNamed } from '../perception/passages.ts';
import { compareText } from '../text-order.ts';
import { scopedSelection } from './dashboard.ts';
import { perceptionRows } from './perception.ts';
import { citationsByAnalysis, evidenceScope, observedAt, type RunSelection } from './selection.ts';

const settings = policy.perception.fact_check;
const CLAIMS_CURSOR_SCOPE = 'visibility.accuracy.claims';

const brandNamedSchema = z
  .array(z.object({ entity_kind: z.string(), state: z.string() }))
  .catch([])
  .transform((rows) => rows.some((row) => row.entity_kind === 'brand' && isNamed(row.state)));
const revisionIdsSchema = z.array(z.string()).catch([]);

type Frozen = {
  versions: PerceptionVersions;
  factCheck: FrozenFactCheck;
  /** Claim topics with a frozen fact in scope; a claim on any other topic is not covered. */
  topics: ReadonlySet<string>;
};
type Subject = { analysisId: string; frozen: Frozen };

function frozenOf(configuration: unknown): Frozen | null {
  const versions = frozenPerceptionVersions(configuration);
  const factCheck = frozenFactCheck(configuration);
  if (!versions || !factCheck) return null;
  return { versions, factCheck, topics: checkedTopics(factCheck) };
}

function identityOf({ versions, factCheck }: Frozen) {
  return JSON.stringify([
    versions.template_version,
    factCheck.verify_template_version,
    factCheck.metrics_version,
    factCheck.fact_set_hash,
  ]);
}

/** Each analysis's extraction and claim rows with their statuses and cited facts. */
async function claimsOf(
  db: Database,
  workspaceId: string,
  subjects: readonly Subject[],
): Promise<Map<string, { extraction: Extraction; claims: ClaimRow[] }>> {
  const byAnalysis = new Map(subjects.map((subject) => [subject.analysisId, subject]));
  const perceptions = await perceptionRows(
    db,
    workspaceId,
    new Map(
      subjects.map(({ analysisId, frozen }) => [analysisId, frozen.versions.extractor_version]),
    ),
  );
  if (!perceptions.length) return new Map();
  const perceptionIds = perceptions.map((row) => row.id);
  const [claimRows, verifications] = await Promise.all([
    chunked(perceptionIds, (ids) =>
      db
        .selectFrom('answer_claims')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('perception_id', 'in', ids)
        .orderBy('ordinal')
        .execute(),
    ),
    chunked(perceptionIds, (ids) =>
      db
        .selectFrom('fact_verifications')
        .select(['id', 'perception_id', 'verify_template_version', 'outcome', 'outcome_reason'])
        .where('workspace_id', '=', workspaceId)
        .where('perception_id', 'in', ids)
        .execute(),
    ),
  ]);
  // Only the verification at the audit's frozen template version counts.
  const versionOf = new Map(
    perceptions.map((row) => [
      row.id,
      byAnalysis.get(row.analysis_id)!.frozen.factCheck.verify_template_version,
    ]),
  );
  const verificationOf = new Map(
    verifications
      .filter((row) => versionOf.get(row.perception_id) === row.verify_template_version)
      .map((row) => [row.perception_id, row]),
  );
  const verdictRows = await chunked(
    [...verificationOf.values()].map((row) => row.id),
    (ids) =>
      db
        .selectFrom('claim_verdicts')
        .select(['claim_id', 'verdict', 'low_confidence', 'fact_revision_ids'])
        .where('workspace_id', '=', workspaceId)
        .where('verification_id', 'in', ids)
        .execute(),
  );
  const verdicts = new Map(
    verdictRows.map((row) => [
      row.claim_id,
      {
        verdict: claimVerdictSchema.parse(row.verdict),
        low_confidence: row.low_confidence,
        revisionIds: revisionIdsSchema.parse(row.fact_revision_ids),
      },
    ]),
  );
  const revisionIds = [...new Set([...verdicts.values()].flatMap((row) => row.revisionIds))];

  const revisions = new Map(
    (
      await chunked(revisionIds, (ids) =>
        db
          .selectFrom('brand_fact_revisions')
          .select(['id', 'topic', 'statement', 'source_url'])
          .where('workspace_id', '=', workspaceId)
          .where('id', 'in', ids)
          .execute(),
      )
    ).flatMap((row) => {
      const topic = factTopicSchema.safeParse(row.topic);
      if (!topic.success) return [];
      const ref: FactRef = {
        topic: topic.data,
        statement: row.statement,
        source_url: row.source_url,
      };
      return [[row.id, ref] as const];
    }),
  );
  const claimsByPerception = groupBy(claimRows, (row) => row.perception_id);
  const result = new Map<string, { extraction: Extraction; claims: ClaimRow[] }>();
  for (const perception of perceptions) {
    const { topics } = byAnalysis.get(perception.analysis_id)!.frozen;
    const reason = unavailableReason(perception);
    if (reason) {
      result.set(perception.analysis_id, {
        extraction: { kind: 'unavailable', reason },
        claims: [],
      });
      continue;
    }
    const verification = verificationOf.get(perception.id);
    const claims = (claimsByPerception.get(perception.id) ?? []).flatMap((row): ClaimRow[] => {
      const topic = factTopicSchema.safeParse(row.topic);
      if (!topic.success) return [];
      const verdict = verdicts.get(row.id);
      return [
        {
          ordinal: row.ordinal,
          claim: row.claim,
          topic: topic.data,
          quote: row.quote,
          start: row.quote_start,
          end: row.quote_end,
          status: claimStatus({
            lowConfidenceClaim: row.low_confidence,
            topicHasFact: topics.has(topic.data),
            verification,
            verdict,
          }),
          facts: (verdict?.revisionIds ?? []).flatMap((id) => revisions.get(id) ?? []),
        },
      ];
    });
    result.set(perception.analysis_id, { extraction: { kind: 'done' }, claims });
  }
  return result;
}

/** The selection's fact-checked answers that name the brand. */
async function selectionAnswers(
  db: Database,
  selection: RunSelection,
  options: { citations: boolean },
) {
  const scoped = await scopedSelection(db, selection);
  const rows = (
    await evidenceScope(db, scoped)
      .where('audit.audit_scope', '=', policy.visibility.brand_audit_scope)
      .select([
        'ra.id',
        'ra.audit_id',
        'ra.task_id',
        'ra.logical_engine',
        'ra.entity_assessments',
        'audit.configuration',
        'snapshot.text as prompt',
        utcTextOf(observedAt).as('observed_at'),
      ])
      .execute()
  ).flatMap((row) => {
    const frozen = frozenOf(row.configuration);
    return frozen ? [{ ...row, frozen }] : [];
  });
  const factChecked = rows.length > 0;
  const named = rows.filter((row) => brandNamedSchema.parse(row.entity_assessments));
  const ids = named.map((row) => row.id);
  const [extracted, citations] = await Promise.all([
    claimsOf(
      db,
      scoped.workspaceId,
      named.map((row) => ({ analysisId: row.id, frozen: row.frozen })),
    ),
    options.citations
      ? citationsByAnalysis(db, scoped.workspaceId, ids)
      : new Map<string, { domain: string; url: string }[]>(),
  ]);
  const answers = named.map((row): FactAnswer => {
    const found = extracted.get(row.id);
    return {
      auditId: row.audit_id,
      executionId: row.task_id,
      observedAt: wireUtc(row.observed_at),
      logicalEngine: row.logical_engine,
      prompt: row.prompt,
      identity: identityOf(row.frozen),
      extraction: found?.extraction ?? { kind: 'pending' },
      claims: found?.claims ?? [],
      citations: citations.get(row.id) ?? [],
    };
  });
  return {
    answers,
    factChecked,
    auditIds: [...new Set(rows.map((row) => row.audit_id))].sort(compareText),
  };
}

export async function getAccuracy(
  db: Database,
  selection: RunSelection,
): Promise<AccuracyResponse> {
  const { answers, factChecked, auditIds } = await selectionAnswers(db, selection, {
    citations: true,
  });
  return { ...accuracySummary(answers, factChecked, settings), source_audit_ids: auditIds };
}

/** The decoded cursor position; a malformed one is refused, never read as the start. */
function cursorPosition(cursor: string, fingerprint: Record<string, unknown>) {
  const [observed_at, execution_id, ordinal] = decodeKeysetCursor(
    cursor,
    CLAIMS_CURSOR_SCOPE,
    fingerprint,
  );
  const offset = Number(ordinal);
  if (observed_at === undefined || execution_id === undefined)
    throw new InvalidCursorError('invalid cursor');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new InvalidCursorError('invalid cursor');
  return { observed_at, execution_id, ordinal: offset };
}

export async function getAccuracyClaims(
  db: Database,
  selection: RunSelection,
  filters: {
    topic: string | null;
    verdict: string | null;
    cursor: string | null;
    limit: number;
  },
) {
  const fingerprint = {
    selection: JSON.stringify(selection),
    topic: filters.topic,
    verdict: filters.verdict,
  };
  const after = filters.cursor ? cursorPosition(filters.cursor, fingerprint) : null;
  const { answers } = await selectionAnswers(db, selection, { citations: false });
  const claims = positionedClaims(
    answers,
    (claim) =>
      (filters.topic === null || claim.topic === filters.topic) &&
      (filters.verdict === null ||
        (claim.status.kind === 'verdict' && claim.status.verdict === filters.verdict)),
  ).filter((claim) => after === null || claimOrder(claim, after) > 0);
  const page = claims.slice(0, filters.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ ordinal: _ordinal, ...claim }) => claim),
    next_cursor:
      last && claims.length > filters.limit
        ? encodeKeysetCursor(CLAIMS_CURSOR_SCOPE, fingerprint, [
            last.observed_at,
            last.execution_id,
            String(last.ordinal),
          ])
        : null,
  };
}

/** One execution's brand claims; empty outside the pilot or for an audit without a fact-check. */
export async function executionClaims(
  db: Database,
  input: { workspaceId: string; analysisId: string; configuration: unknown },
): Promise<ExecutionClaim[]> {
  const frozen = frozenOf(input.configuration);
  if (!frozen) return [];
  const found = await claimsOf(db, input.workspaceId, [{ analysisId: input.analysisId, frozen }]);
  return (found.get(input.analysisId)?.claims ?? []).map((claim) => ({
    ...claimView(claim),
    start: claim.start,
    end: claim.end,
  }));
}
