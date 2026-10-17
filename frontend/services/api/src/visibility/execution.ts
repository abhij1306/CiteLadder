/**
 * One execution's persisted analysis and citation evidence.
 *
 * Shared API/MCP reader. Keyed on the execution (`AuditTask`) id clients
 * receive from the executions list; provenance comes from the frozen task
 * and audit snapshots, never from live configuration.
 */
import { sql } from 'kysely';

import { executionFrozenProvenance } from '../analysis/provenance.ts';
import {
  citationClassificationSchema,
  executionEvidenceSchema,
} from '@citeladder/contracts/audits';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { wireUtc, utcText } from '../db/timestamps.ts';
import { AnalysisNotFoundError } from './selection.ts';
import { executionSurfaceEvidence } from './surface.ts';
import { executionClaims } from './accuracy.ts';
import { executionPerception } from './perception.ts';
import { executionAds } from './ads.ts';

export type ExecutionEvidenceResponse = z.input<typeof executionEvidenceSchema>;

function scoreObject(score: unknown): Record<string, unknown> | null {
  if (score === null) return null;
  if (typeof score === 'object' && !Array.isArray(score)) return score as Record<string, unknown>;
  throw new TypeError('stored score is not an object');
}

/** Stored competitor mentions are names, not arbitrary iterable values. */
function competitorsMentioned(score: Record<string, unknown> | null): string[] {
  const names = score?.competitors_mentioned;
  if (names === null || names === undefined) return [];
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string'))
    throw new TypeError('stored competitors_mentioned is not a list of names');
  return names;
}

export async function getExecutionEvidence(
  db: Database,
  input: { workspaceId: string; taskId: string },
): Promise<ExecutionEvidenceResponse> {
  const analysis = await db
    .selectFrom('response_analyses')
    .selectAll()
    .select(utcText(sql.ref('created_at')).as('created_at_text'))
    .where('task_id', '=', input.taskId)
    .where('workspace_id', '=', input.workspaceId)
    .limit(1)
    .executeTakeFirst();
  if (analysis === undefined) throw new AnalysisNotFoundError('Execution analysis not found');
  const citations = await db
    .selectFrom('citations')
    .select([
      'ordinal',
      'url',
      'title',
      'domain',
      'classification',
      'source_class',
      'source_origin',
      'source_taxonomy_version',
      'is_owned',
      'is_unintended',
      'matched_competitor',
    ])
    .where('analysis_id', '=', analysis.id)
    .where('workspace_id', '=', input.workspaceId)
    .orderBy('ordinal', 'asc')
    .execute();
  // Frozen provenance from the task and audit parents.
  // audit_tasks has no workspace column; it is scoped through its audit.
  const task = await db
    .selectFrom('audit_tasks')
    .select(['request_snapshot', 'provider_route_snapshot'])
    .where('id', '=', input.taskId)
    .where('audit_id', '=', analysis.audit_id)
    .executeTakeFirst();
  const audit = await db
    .selectFrom('audits')
    .select('configuration')
    .where('id', '=', analysis.audit_id)
    .where('workspace_id', '=', input.workspaceId)
    .executeTakeFirst();
  const score = scoreObject(analysis.score);
  const [search_surface, perception, claims, ads] = await Promise.all([
    executionSurfaceEvidence(db, {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      analysis,
    }),
    executionPerception(db, {
      workspaceId: input.workspaceId,
      analysisId: analysis.id,
      assessments: analysis.entity_assessments,
      configuration: audit?.configuration ?? null,
    }),
    executionClaims(db, {
      workspaceId: input.workspaceId,
      analysisId: analysis.id,
      configuration: audit?.configuration ?? null,
    }),
    executionAds(db, {
      workspaceId: input.workspaceId,
      artifactId: analysis.artifact_id,
      logicalEngine: analysis.logical_engine,
      adsParserVersion: analysis.ads_parser_version,
    }),
  ]);
  return {
    id: analysis.task_id,
    analysis_id: analysis.id,
    audit_id: analysis.audit_id,
    task_id: analysis.task_id,
    artifact_id: analysis.artifact_id,
    analyzer_version: analysis.analyzer_version,
    scoring_rule_version: analysis.scoring_rule_version,
    logical_engine: analysis.logical_engine,
    transport_provider: analysis.transport_provider,
    transport_model: analysis.transport_model,
    retrieval_enabled: executionFrozenProvenance({
      requestSnapshot: task?.request_snapshot ?? null,
      routeSnapshot: task?.provider_route_snapshot ?? null,
      auditConfiguration: audit?.configuration ?? null,
    }),
    prompt_index: analysis.prompt_index,
    repetition: analysis.repetition,
    prompt_class: analysis.prompt_class,
    cohort: analysis.cohort,
    brand_mentioned: analysis.brand_mentioned,
    brand_first_offset: analysis.brand_first_offset,
    owned_domain_cited: analysis.owned_domain_cited,
    owned_citation_count: analysis.owned_citation_count,
    unintended_domain_cited: analysis.unintended_domain_cited,
    citation_count: analysis.citation_count,
    search_used: analysis.search_used,
    search_query_count: analysis.search_query_count,
    avg_position: analysis.avg_position,
    score,
    citations: citations.map((citation) => ({
      ...citation,
      classification: citationClassificationSchema.parse(citation.classification),
    })),
    competitors_mentioned: competitorsMentioned(score),
    // Null for an LLM execution, and for a search that produced no
    // observation row: a gap in ours, not a measured absence.
    search_surface,
    perception,
    claims,
    ads,
    created_at: wireUtc(analysis.created_at_text!),
  };
}
