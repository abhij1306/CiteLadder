import { executionEvidenceSchema, promptAnswerSearchSchema } from '@citeladder/contracts/audits';
import { promptAnswerPageSchema } from '@citeladder/contracts/visibility-prompt-answers';

import { policy } from '../config.ts';
import { notFound } from '../errors.ts';
import { AnalysisNotFoundError } from '../visibility/selection.ts';
import { getExecutionEvidence } from '../visibility/execution.ts';
import { getPromptAnswers } from '../visibility/prompt-answers.ts';
import { defineGetRoute } from './define.ts';
import { CURSOR, ENGINE, LIMIT, MARKET, selectionErrors, WINDOW } from './visibility-selection.ts';

const uuid = { scalar: { kind: 'uuid' }, required: true } as const;

export const executionRoutes = [
  defineGetRoute({
    family: 'executions',
    path: '/api/v1/executions/{execution_id}',
    params: { path: { execution_id: uuid }, query: {} },
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
  defineGetRoute({
    family: 'executions',
    authorize: 'active-project',
    exposure: 'both',
    publicPath: '/v1/projects/{project_id}/prompts/{prompt_id}/answers',
    path: '/api/v1/projects/{project_id}/prompts/{prompt_id}/executions',
    params: {
      path: { project_id: uuid, prompt_id: uuid },
      query: {
        ...MARKET,
        engine: ENGINE,
        ...WINDOW,
        brand: {
          scalar: { kind: 'str', maxLength: 255 },
          description: 'Only answers that named this tracked brand or competitor.',
        },
        cited: {
          scalar: { kind: 'bool' },
          description: "Only answers that cited your site (`true`) or didn't (`false`).",
        },
        search: {
          scalar: { kind: 'literal', values: promptAnswerSearchSchema.options },
          description:
            "Web search use: `used`, `not_used`, or `not_reported` by an engine that doesn't expose it.",
        },
        cursor: CURSOR,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.visibility.prompt_answers_max_limit },
          default: policy.visibility.prompt_answers_page_size,
          description: LIMIT.description,
        },
      },
    },
    response: promptAnswerPageSchema,
    async handle({ c, db }, { path, query }) {
      const scope = {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
        marketId: query.market,
      };
      return selectionErrors(
        () =>
          getPromptAnswers(db, scope, {
            promptId: path.prompt_id,
            logicalEngine: query.engine,
            fromAt: query.from_at,
            toAt: query.to_at,
            brand: query.brand,
            cited: query.cited,
            search: query.search,
            cursor: query.cursor,
            limit: query.limit,
          }),
        () => notFound('Prompt'),
      );
    },
  }),
];
