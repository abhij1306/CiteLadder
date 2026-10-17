/**
 * The fact verification request and its deterministic checks. The model
 * judges each claim against the frozen confirmed facts it is shown; code
 * decides what survives: only facts that were sent may be cited, a supported
 * or contradicted verdict must cite one, and a contradiction below its stricter
 * confidence floor is reported as inconclusive (low confidence).
 */
import { createHash } from 'node:crypto';

import type { ClaimVerdict, FactTopic } from '@citeladder/contracts/fact-checking';
import { claimVerdictSchema } from '@citeladder/contracts/fact-checking';
import { z } from 'zod';

import type { FactCheckPolicy } from '../config/perception.ts';
import { canonicalJson } from '../search-intelligence/requests.ts';

export type VerifyFact = { revisionId: string; topic: FactTopic; statement: string };
export type VerifyClaim = { claimId: string; topic: FactTopic; claim: string; quote: string };

/** What the model sees: short local ids, never record ids. */
export type VerifyPackage = {
  verify_template_version: string;
  brand: string;
  language: string;
  facts: { fact_id: string; topic: FactTopic; statement: string }[];
  claims: { claim_id: string; topic: FactTopic; claim: string; quote: string }[];
};

/**
 * Up to `max` facts on `topics` (in priority order), taken one per topic in
 * turn (frozen order within a topic), so a topic with many facts never crowds
 * another out and the claims' own topics lead each round.
 */
function sharedByTopic(facts: readonly VerifyFact[], topics: readonly FactTopic[], max: number) {
  const queues = new Map<FactTopic, VerifyFact[]>(topics.map((topic) => [topic, []]));
  for (const fact of facts) queues.get(fact.topic)?.push(fact);
  const picked: VerifyFact[] = [];
  let round = 0;
  while (picked.length < max) {
    const next = [...queues.values()].flatMap((queue) => queue[round] ?? []);
    if (!next.length) break;
    picked.push(...next.slice(0, max - picked.length));
    round += 1;
  }
  return picked;
}

/**
 * The package for one answer's claims: the frozen facts on the claims' topics
 * and their neighbours (`scope`), capped. Local ids map back to fact revisions
 * and claims.
 */
export function verifyPackage(input: {
  version: string;
  brand: string;
  language: string;
  facts: readonly VerifyFact[];
  claims: readonly VerifyClaim[];
  /** A claim topic's checked topics, its own first. */
  scope: (topic: FactTopic) => readonly FactTopic[];
  maxFacts: number;
}) {
  const own = input.claims.map((claim) => claim.topic);
  const neighbours = own.flatMap((topic) => input.scope(topic));
  const facts = sharedByTopic(input.facts, [...new Set([...own, ...neighbours])], input.maxFacts);
  const factIds = new Map(facts.map((fact, index) => [`f${index + 1}`, fact.revisionId]));
  const claimIds = new Map(input.claims.map((claim, index) => [`c${index + 1}`, claim.claimId]));
  const pkg: VerifyPackage = {
    verify_template_version: input.version,
    brand: input.brand,
    language: input.language,
    facts: facts.map((fact, index) => ({
      fact_id: `f${index + 1}`,
      topic: fact.topic,
      statement: fact.statement,
    })),
    claims: input.claims.map((claim, index) => ({
      claim_id: `c${index + 1}`,
      topic: claim.topic,
      claim: claim.claim,
      quote: claim.quote,
    })),
  };
  return { pkg, factIds, claimIds };
}

export function verifyHash(pkg: VerifyPackage): string {
  return createHash('sha256').update(canonicalJson(pkg, false)).digest('hex');
}

export const verifyOutputSchema = z.object({
  verdicts: z.array(
    z.object({
      claim_id: z.string(),
      verdict: claimVerdictSchema,
      fact_ids: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type VerifyOutput = z.infer<typeof verifyOutputSchema>;

/** The system and user messages; one substitution pass, so answer text is never re-substituted. */
export function verifyPrompt(
  pkg: VerifyPackage,
  policy: Pick<FactCheckPolicy, 'verify_system_template' | 'verify_user_template'>,
) {
  const slots: Record<string, string> = {
    '{brand}': pkg.brand,
    '{language}': pkg.language || 'unknown',
    '{facts}': JSON.stringify(pkg.facts, null, 2),
    '{claims}': JSON.stringify(pkg.claims, null, 2),
  };
  const user = policy.verify_user_template.replaceAll(
    /\{(?:brand|language|facts|claims)\}/gu,
    (slot) => slots[slot] ?? slot,
  );
  return { system: policy.verify_system_template, user };
}

export type VerifiedVerdict = {
  claimId: string;
  verdict: ClaimVerdict;
  /** What the model said, before the deterministic downgrades. */
  modelVerdict: ClaimVerdict | null;
  factRevisionIds: string[];
  confidence: number | null;
  lowConfidence: boolean;
};

export type VerifyDropReason =
  | 'unknown_claim'
  | 'duplicate_claim'
  | 'missing_claim'
  | 'unknown_fact'
  | 'verdict_without_fact'
  | 'low_confidence_contradiction';

/** One verdict per claim sent; every downgrade and drop is counted by reason. */
export function validateVerdicts(
  output: VerifyOutput,
  ids: { factIds: ReadonlyMap<string, string>; claimIds: ReadonlyMap<string, string> },
  policy: Pick<FactCheckPolicy, 'min_confidence' | 'min_contradiction_confidence'>,
) {
  const drops: Partial<Record<VerifyDropReason, number>> = {};
  const drop = (reason: VerifyDropReason, count = 1) => {
    if (count > 0) drops[reason] = (drops[reason] ?? 0) + count;
  };
  const results = new Map<string, VerifiedVerdict>();
  for (const row of output.verdicts) {
    const claimId = ids.claimIds.get(row.claim_id);
    if (!claimId) {
      drop('unknown_claim');
      continue;
    }
    if (results.has(claimId)) {
      drop('duplicate_claim');
      continue;
    }
    const cited = [...new Set(row.fact_ids)];
    const factRevisionIds = cited.flatMap((id) => {
      const revision = ids.factIds.get(id);
      return revision ? [revision] : [];
    });
    drop('unknown_fact', cited.length - factRevisionIds.length);
    let verdict = row.verdict;
    let lowConfidence = row.confidence < policy.min_confidence;
    if ((verdict === 'supported' || verdict === 'contradicted') && !factRevisionIds.length) {
      drop('verdict_without_fact');
      verdict = 'inconclusive';
    } else if (verdict === 'contradicted' && row.confidence < policy.min_contradiction_confidence) {
      drop('low_confidence_contradiction');
      verdict = 'inconclusive';
      lowConfidence = true;
    } else if (verdict === 'supported' && lowConfidence) verdict = 'inconclusive';
    results.set(claimId, {
      claimId,
      verdict,
      modelVerdict: row.verdict,
      factRevisionIds,
      confidence: row.confidence,
      lowConfidence,
    });
  }
  const verdicts = [...ids.claimIds.values()].map((claimId): VerifiedVerdict => {
    const found = results.get(claimId);
    if (found) return found;
    drop('missing_claim');
    return {
      claimId,
      verdict: 'not_covered',
      modelVerdict: null,
      factRevisionIds: [],
      confidence: null,
      lowConfidence: false,
    };
  });
  return { verdicts, drops };
}
