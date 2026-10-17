import { randomUUID } from 'node:crypto';
import type { DeriveExecution } from '../audits/result-persistence.ts';
import { policy } from '../config.ts';
import { record, jsonObjects } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import {
  scoreExecution,
  scoringConfig,
  classifyCitation,
  type ClassifiedCitation,
} from './scoring.ts';
import { assessEntities } from './entity-assessment.ts';
import { classifySourceDomain, classifySourceOrigin } from './opportunities/source-patterns.ts';
import { citationIdentity } from '../source-pages/identity.ts';
import { fanoutProjection } from './fanout.ts';
import { enqueuePerception } from '../perception/admission.ts';
import { answerAds, persistAds } from './ads.ts';

/** A retrieved URL is never provider-resolved, so it keeps no resolved URL. */
function retrievedIdentity(url: string) {
  const { resolved_url: _resolved, ...identity } = citationIdentity(url);
  return identity;
}

function citationClassification(classified: ClassifiedCitation) {
  if (classified.is_owned) return 'owned';
  if (classified.is_unintended) return 'unintended';
  return classified.matched_competitor ? 'competitor' : 'third_party';
}

/** Caller holds the scoped audit/task lock and commits alongside the immutable artifact. */
export const analyzeExecution: DeriveExecution = async (db, task, audit, artifactId) => {
  const existing = await db
    .selectFrom('response_analyses')
    .selectAll()
    .where('workspace_id', '=', task.workspace_id)
    .where('audit_id', '=', audit.id)
    .where('task_id', '=', task.id)
    .executeTakeFirst();
  if (existing) {
    if (existing.artifact_id !== artifactId) throw new Error('Analysis artifact mismatch');
    return;
  }
  const artifact = await db
    .selectFrom('raw_response_artifacts')
    .selectAll()
    .where('id', '=', artifactId)
    .where('audit_id', '=', audit.id)
    .where('task_id', '=', task.id)
    .executeTakeFirstOrThrow();
  const snapshot = await db
    .selectFrom('audit_prompt_snapshots')
    .select(['cohort', 'text'])
    .where('id', '=', task.prompt_snapshot_id)
    .where('audit_id', '=', audit.id)
    .executeTakeFirstOrThrow();
  const config = scoringConfig(audit.configuration),
    metadata = record(artifact.provider_metadata);
  const citations = jsonObjects(artifact.citations ?? [], 'artifact.citations');
  // Null when the surface does not expose what it read.
  const retrieved =
    artifact.retrieved_sources === null
      ? null
      : jsonObjects(artifact.retrieved_sources, 'artifact.retrieved_sources');
  const score = {
    ...scoreExecution({
      config,
      answerText: artifact.answer_text,
      promptText: snapshot.text,
      citations,
      searchEvents: jsonObjects(artifact.search_events ?? [], 'artifact.search_events'),
      searchUsed: artifact.search_used,
      queryTextAvailable:
        metadata.query_text_available === undefined ? true : Boolean(metadata.query_text_available),
    }),
    cohort: snapshot.cohort,
  };
  const at = new Date(),
    id = randomUUID(),
    versions = policy.audits.analysis,
    assessments = assessEntities(artifact.answer_text, config),
    ads = answerAds({
      id: task.id,
      logical_engine: task.logical_engine,
      providerMetadata: artifact.provider_metadata,
    });
  await db
    .insertInto('response_analyses')
    .values({
      id,
      workspace_id: task.workspace_id,
      audit_id: audit.id,
      task_id: task.id,
      artifact_id: artifactId,
      analyzer_version: versions.analyzer_version,
      scoring_rule_version: versions.scoring_rule_version,
      logical_engine: task.logical_engine,
      transport_provider: task.transport_provider,
      transport_model: task.transport_model,
      prompt_index: task.prompt_index,
      repetition: task.repetition,
      prompt_class: score.prompt_class,
      cohort: snapshot.cohort,
      brand_mentioned: score.brand_mentioned,
      brand_first_offset: score.brand_first_offset,
      owned_domain_cited: score.owned_domain_cited,
      owned_citation_count: score.owned_citation_count,
      unintended_domain_cited: score.unintended_domain_cited,
      citation_count: score.citation_count,
      search_used: score.search_used,
      search_query_count: score.search_query_count,
      ...fanoutProjection({
        artifactEvents: artifact.search_events,
        taskEvents: task.search_events,
        searchUsed: score.search_used,
        searchQueryCount: score.search_query_count,
        providerMetadata: task.provider_metadata,
      }),
      // Set only when ads apply and the envelope was read: zero ads is then an observation.
      ads_parser_version: ads ? policy.audits.ads_versions.parser_version : null,
      avg_position: score.brand_position,
      score: JSON.stringify(score),
      entity_assessments: JSON.stringify(assessments),
      retrieval_observed: retrieved !== null,
      created_at: at,
    })
    .execute();
  const provenance = {
    workspace_id: task.workspace_id,
    audit_id: audit.id,
    analysis_id: id,
    artifact_id: artifactId,
    analyzer_version: versions.analyzer_version,
    created_at: at,
  };
  if (score.brand_mentioned)
    await db
      .insertInto('brand_mentions')
      .values({
        ...provenance,
        id: randomUUID(),
        brand_name: config.brandName,
        first_offset: score.brand_first_offset,
      })
      .execute();
  if (score.competitors_mentioned.length)
    await db
      .insertInto('competitor_mentions')
      .values(
        score.competitors_mentioned.map((name) => ({
          ...provenance,
          id: randomUUID(),
          competitor_name: name,
          first_offset: score.competitor_first_offsets[name] ?? null,
        })),
      )
      .execute();
  if (citations.length)
    await db
      .insertInto('citations')
      .values(
        citations.map((citation, ordinal) => {
          const classified = classifyCitation(citation, config),
            resolved = scalarText(citation.resolved_url).trim();
          return {
            ...provenance,
            id: randomUUID(),
            ordinal: typeof citation.ordinal === 'number' ? citation.ordinal : ordinal,
            url: scalarText(citation.url),
            title: scalarText(citation.title),
            domain: classified.domain,
            classification: citationClassification(classified),
            source_class: classifySourceDomain(
              classified.domain,
              classified.is_owned,
              classified.matched_competitor,
            ),
            source_origin: classifySourceOrigin(classified.domain),
            source_taxonomy_version: policy.opportunity.source_patterns.SOURCE_TAXONOMY_VERSION,
            is_owned: classified.is_owned,
            is_unintended: classified.is_unintended,
            matched_competitor: classified.matched_competitor,
            ...citationIdentity(resolved || scalarText(citation.url), Boolean(resolved)),
          };
        }),
      )
      .execute();
  if (retrieved?.length)
    await db
      .insertInto('retrieved_sources')
      .values(
        retrieved.map((source, ordinal) => {
          const classified = classifyCitation(source, config);
          return {
            ...provenance,
            id: randomUUID(),
            ordinal: typeof source.ordinal === 'number' ? source.ordinal : ordinal,
            url: scalarText(source.url),
            title: scalarText(source.title),
            domain: classified.domain,
            is_owned: classified.is_owned,
            ...retrievedIdentity(scalarText(source.url)),
          };
        }),
      )
      .execute();
  if (ads)
    await persistAds(db, {
      workspaceId: task.workspace_id,
      projectId: audit.project_id,
      auditId: audit.id,
      taskId: task.id,
      artifactId,
      config,
      ads,
      at,
    });
  await db
    .updateTable('audit_tasks')
    .set({ score: JSON.stringify(score) })
    .where('workspace_id', '=', task.workspace_id)
    .where('audit_id', '=', audit.id)
    .where('id', '=', task.id)
    .execute();
  await enqueuePerception(db, {
    workspaceId: task.workspace_id,
    projectId: audit.project_id,
    configuration: audit.configuration,
    analysisId: id,
    assessments,
  });
};
