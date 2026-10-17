/**
 * Fact-check metrics over persisted claims and verdicts: pure and
 * deterministic. A claim without a verdict is a counted state (pending,
 * unavailable by reason, low confidence), never a zero, and accuracy always
 * travels with the coverage it was computed over.
 */
import {
  claimUnavailableReasonSchema,
  type AccuracyClaim,
  type AccuracyCoverage,
  type AccuracyResponse,
  type AccuracyScore,
  type ClaimVerdict,
  type FactTopic,
} from '@citeladder/contracts/fact-checking';
import type { z } from 'zod';

import { compareText } from '../text-order.ts';
import { citedDomains, runPoints } from './metrics.ts';

export type UnavailableReason = z.infer<typeof claimUnavailableReasonSchema>;

export type ClaimStatus =
  | { kind: 'verdict'; verdict: ClaimVerdict }
  | { kind: 'low_confidence' }
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type FactRef = AccuracyClaim['facts'][number];

export type ClaimRow = {
  ordinal: number;
  claim: string;
  topic: FactTopic;
  quote: string;
  start: number;
  end: number;
  status: ClaimStatus;
  facts: FactRef[];
};

/** Claim extraction for one answer that names the brand. */
export type Extraction =
  | { kind: 'done' }
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type FactAnswer = {
  auditId: string;
  executionId: string;
  observedAt: string;
  logicalEngine: string;
  prompt: string;
  /** Templates, metrics version and fact set; a change breaks trend comparability. */
  identity: string;
  extraction: Extraction;
  claims: ClaimRow[];
  citations: { domain: string; url: string }[];
};

/** A persisted perception or verification outcome as an unavailable reason, or null when it ran. */
export function unavailableReason(row: {
  outcome: string;
  outcome_reason: string | null;
}): UnavailableReason | null {
  if (row.outcome === 'invalid_output' || row.outcome === 'model_error') return row.outcome;
  if (row.outcome !== 'unavailable') return null;
  const reason = claimUnavailableReasonSchema.safeParse(row.outcome_reason);
  return reason.success ? reason.data : 'task_failed';
}

/**
 * One claim's status: a low-confidence claim is never verified; a topic with
 * no frozen fact is not covered without a model call; otherwise the
 * verification outcome and verdict row decide.
 */
export function claimStatus(input: {
  lowConfidenceClaim: boolean;
  topicHasFact: boolean;
  verification: { outcome: string; outcome_reason: string | null } | undefined;
  verdict: { verdict: ClaimVerdict; low_confidence: boolean } | undefined;
}): ClaimStatus {
  if (input.lowConfidenceClaim) return { kind: 'low_confidence' };
  if (!input.topicHasFact) return { kind: 'verdict', verdict: 'not_covered' };
  if (!input.verification) return { kind: 'pending' };
  const reason = unavailableReason(input.verification);
  if (reason) return { kind: 'unavailable', reason };
  if (!input.verdict) return { kind: 'verdict', verdict: 'not_covered' };
  if (input.verdict.low_confidence) return { kind: 'low_confidence' };
  return { kind: 'verdict', verdict: input.verdict.verdict };
}

function emptyCoverage(): AccuracyCoverage {
  return {
    claims: 0,
    supported: 0,
    contradicted: 0,
    inconclusive: 0,
    not_covered: 0,
    low_confidence: 0,
    pending: 0,
    unavailable: [],
    answers_pending: 0,
    answers_unavailable: 0,
  };
}

/** Accuracy and coverage over claims, plus the answers whose extraction is not done. */
function scoreClaims(
  claims: readonly { status: ClaimStatus }[],
  extractions: readonly Extraction[] = [],
): AccuracyScore {
  const coverage = emptyCoverage();
  const unavailable = new Map<UnavailableReason, number>();
  for (const extraction of extractions) {
    if (extraction.kind === 'pending') coverage.answers_pending++;
    if (extraction.kind === 'unavailable') coverage.answers_unavailable++;
  }
  for (const { status } of claims) {
    coverage.claims++;
    if (status.kind === 'verdict') coverage[status.verdict]++;
    else if (status.kind === 'unavailable')
      unavailable.set(status.reason, (unavailable.get(status.reason) ?? 0) + 1);
    else coverage[status.kind]++;
  }
  coverage.unavailable = [...unavailable]
    .map(([reason, total]) => ({ reason, count: total }))
    .sort((a, b) => b.count - a.count || compareText(a.reason, b.reason));
  const decided = coverage.supported + coverage.contradicted;
  return { accuracy: decided ? coverage.supported / decided : null, coverage };
}

export function score(answers: readonly FactAnswer[]): AccuracyScore {
  return scoreClaims(
    answers.flatMap((answer) => answer.claims),
    answers.map((answer) => answer.extraction),
  );
}

/** The read state: a value once any claim has a verdict. */
function readState(
  answers: readonly FactAnswer[],
  factChecked: boolean,
  { coverage }: AccuracyScore,
): Pick<AccuracyResponse, 'state' | 'reason'> {
  if (!factChecked) return { state: 'no_facts', reason: null };
  const verdicts =
    coverage.supported + coverage.contradicted + coverage.inconclusive + coverage.not_covered;
  if (verdicts > 0) return { state: 'value', reason: null };
  if (coverage.pending > 0 || coverage.answers_pending > 0)
    return { state: 'pending', reason: null };
  const extraction = answers.flatMap((answer) =>
    answer.extraction.kind === 'unavailable' ? [answer.extraction.reason] : [],
  );
  const reason = coverage.unavailable[0]?.reason ?? extraction[0];
  if (reason) return { state: 'unavailable', reason };
  return { state: 'no_claims', reason: null };
}

function breakdown(
  answers: readonly FactAnswer[],
  key: (answer: FactAnswer, claim: ClaimRow) => string,
) {
  const groups = new Map<string, ClaimRow[]>();
  for (const answer of answers)
    for (const claim of answer.claims) {
      const groupKey = key(answer, claim);
      const group = groups.get(groupKey);
      if (group) group.push(claim);
      else groups.set(groupKey, [claim]);
    }
  return [...groups]
    .map(([groupKey, claims]) => ({ key: groupKey, label: groupKey, score: scoreClaims(claims) }))
    .sort((a, b) => b.score.coverage.claims - a.score.coverage.claims || compareText(a.key, b.key));
}

/** A claim with its answer context, ordered newest answer first. */
export type PositionedClaim = AccuracyClaim & { ordinal: number };

export function claimOrder(
  a: Pick<PositionedClaim, 'observed_at' | 'execution_id' | 'ordinal'>,
  b: Pick<PositionedClaim, 'observed_at' | 'execution_id' | 'ordinal'>,
) {
  return (
    compareText(b.observed_at, a.observed_at) ||
    compareText(a.execution_id, b.execution_id) ||
    a.ordinal - b.ordinal
  );
}

export function claimView(claim: ClaimRow) {
  const { status } = claim;
  return {
    claim: claim.claim,
    topic: claim.topic,
    quote: claim.quote,
    status: status.kind,
    verdict: status.kind === 'verdict' ? status.verdict : null,
    reason: status.kind === 'unavailable' ? status.reason : null,
    facts: claim.facts,
  };
}

/** The claims `keep` accepts, with their answer context, in claim order. */
export function positionedClaims(
  answers: readonly FactAnswer[],
  keep: (claim: ClaimRow) => boolean = () => true,
): PositionedClaim[] {
  return answers
    .flatMap((answer) =>
      answer.claims.filter(keep).map((claim) => ({
        ...claimView(claim),
        logical_engine: answer.logicalEngine,
        prompt: answer.prompt,
        run_id: answer.auditId,
        execution_id: answer.executionId,
        observed_at: answer.observedAt,
        ordinal: claim.ordinal,
      })),
    )
    .sort(claimOrder);
}

function isContradicted(claim: { status: ClaimStatus }) {
  return claim.status.kind === 'verdict' && claim.status.verdict === 'contradicted';
}

/** One point per run; a change of templates, metrics or fact set breaks comparability. */
function trend(answers: readonly FactAnswer[]) {
  return runPoints(answers, (first) => first.identity).map(
    ({ auditId, rows, completedAt, comparable }) => ({
      audit_id: auditId,
      completed_at: completedAt,
      score: score(rows),
      comparable,
    }),
  );
}

/**
 * The selection's summary. `factChecked` says whether any selected run froze
 * a fact check, so a checked run whose answers never named the brand reads as
 * no claims rather than no facts.
 */
export function accuracySummary(
  answers: readonly FactAnswer[],
  factChecked: boolean,
  limits: { max_contradicted_claims: number; max_cited_alongside: number },
): Omit<AccuracyResponse, 'source_audit_ids'> {
  const total = score(answers);
  return {
    ...readState(answers, factChecked, total),
    score: total,
    topics: breakdown(answers, (_answer, claim) => claim.topic),
    engines: breakdown(answers, (answer) => answer.logicalEngine),
    contradicted: positionedClaims(answers, isContradicted)
      .slice(0, limits.max_contradicted_claims)
      .map(({ ordinal: _ordinal, ...claim }) => claim),
    // Domains cited in answers that carry a contradicted claim: co-occurrence only.
    cited_alongside: citedDomains(
      answers,
      (answer) => answer.claims.some(isContradicted),
      limits.max_cited_alongside,
    ),
    trend: trend(answers),
  };
}
