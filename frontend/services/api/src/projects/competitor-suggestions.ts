/**
 * Evidence-backed competitor suggestions from completed audits.
 *
 * The audit projection records candidates; a person accepts one here,
 * which adds (or reuses) a tracked competitor. Accepts take the project row
 * lock before the candidate row, so concurrent accepts cannot both add a
 * competitor past the project ceiling or duplicate one.
 */
import { randomUUID } from 'node:crypto';

import { competitorSchema } from '@citeladder/contracts/project';
import { observedCompetitorSchema } from '@citeladder/contracts/visibility';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { competitorView, lockProject } from './competitors.ts';
import type { ProjectScope } from './brand-profile.ts';

type Suggestion = z.input<typeof observedCompetitorSchema>;
type Competitor = z.input<typeof competitorSchema>;

const {
  suggestion_pending: PENDING,
  suggestion_accepted: ACCEPTED,
  max_project_competitors: MAX_COMPETITORS,
} = policy.brand_identity;
const ids = z.array(z.string());
const strings = z.array(z.string());

export async function listSuggestions(db: Database, scope: ProjectScope): Promise<Suggestion[]> {
  const rows = await db
    .selectFrom('observed_entity_candidates')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', '=', PENDING)
    .orderBy('prompt_count', 'desc')
    .orderBy('engine_count', 'desc')
    .orderBy('domain')
    .orderBy('id')
    .execute();
  return rows.map(({ workspace_id: _workspace, project_id: _project, ...row }) => ({
    ...row,
    source_analysis_ids: ids.parse(row.source_analysis_ids),
    source_artifact_ids: ids.parse(row.source_artifact_ids),
    created_at: row.created_at.toISOString(),
  }));
}

/**
 * Track the suggested competitor: an existing competitor with the same name
 * or domain is reused, otherwise one is added within the project ceiling.
 */
export function acceptSuggestion(
  db: Database,
  scope: ProjectScope,
  candidateId: string,
): Promise<Competitor> {
  return db.transaction().execute(async (trx) => {
    await lockProject(trx, scope);
    const candidate = await trx
      .selectFrom('observed_entity_candidates')
      .select(['id', 'name', 'domain'])
      .where('id', '=', candidateId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (candidate === undefined) throw notFound('Competitor suggestion');
    const competitors = await trx
      .selectFrom('competitors')
      .select(['id', 'name', 'aliases', 'domains', 'logo_asset_id'])
      .where('project_id', '=', scope.projectId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    let competitor = competitors.find(
      (row) =>
        row.name.toLowerCase() === candidate.name.toLowerCase() ||
        strings
          .parse(row.domains)
          .some((domain) => domain.toLowerCase() === candidate.domain.toLowerCase()),
    );
    if (competitor === undefined) {
      if (competitors.length >= MAX_COMPETITORS)
        throw new ApiError(
          409,
          `A project can have at most ${MAX_COMPETITORS} competitors; remove one before accepting this suggestion`,
        );
      const now = new Date();
      competitor = await trx
        .insertInto('competitors')
        .values({
          id: randomUUID(),
          project_id: scope.projectId,
          name: candidate.name,
          aliases: JSON.stringify([candidate.name]),
          domains: JSON.stringify([candidate.domain]),
          created_at: now,
          updated_at: now,
        })
        .returning(['id', 'name', 'aliases', 'domains', 'logo_asset_id'])
        .executeTakeFirstOrThrow();
    }
    await trx
      .updateTable('observed_entity_candidates')
      .set({ status: ACCEPTED })
      .where('id', '=', candidate.id)
      .execute();
    return competitorView(scope.projectId, competitor);
  });
}
