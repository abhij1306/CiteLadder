import { analyzeResponse } from '../analysis/execution.ts';
import { enqueuePerception } from '../perception/admission.ts';
import type { DeriveExecution } from './result-persistence.ts';

/**
 * The audit's derivation step for one successful answer: the deterministic analysis, then
 * its downstream perception work, both inside the caller's locked transaction. An answer
 * already analyzed enqueues nothing again.
 */
export const deriveExecution: DeriveExecution = async (db, task, audit, artifactId) => {
  const analysis = await analyzeResponse(db, task, audit, artifactId);
  if (!analysis) return;
  await enqueuePerception(db, {
    workspaceId: task.workspace_id,
    projectId: audit.project_id,
    configuration: audit.configuration,
    analysisId: analysis.analysisId,
    assessments: analysis.assessments,
  });
};
