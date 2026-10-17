/**
 * `executions`: one execution's persisted analysis and citation evidence.
 *
 * `execution_id` is the
 * execution (`AuditTask`) id from `GET /audits/{id}/executions`; the read is
 * workspace-scoped and projection-only.
 */
import { executionEvidenceSchema } from '@citeladder/contracts/audits';

import { notFound } from '../errors.ts';
import { AnalysisNotFoundError } from '../visibility/selection.ts';
import { getExecutionEvidence } from '../visibility/execution.ts';
import { defineGetRoute } from './define.ts';

export const executionRoutes = [
  defineGetRoute({
    family: 'executions',
    path: '/api/v1/executions/{execution_id}',
    params: { path: { execution_id: { scalar: { kind: 'uuid' }, required: true } }, query: {} },
    response: executionEvidenceSchema,
    async handle({ c, db }, { path }) {
      try {
        return await getExecutionEvidence(db, {
          workspaceId: c.get('workspace').workspaceId,
          taskId: path.execution_id,
        });
      } catch (error) {
        if (error instanceof AnalysisNotFoundError) throw notFound('Execution');
        throw error;
      }
    },
  }),
];
