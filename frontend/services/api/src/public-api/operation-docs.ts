import { OPERATION_TEXT } from './operation-docs-text.ts';

export type OperationDoc = {
  summary: string;
  description: string;
  request?: unknown;
};

const PROJECT_PREFIX = '/v1/projects/{project_id}';
const IDEMPOTENCY_ADVICE =
  ' Send an Idempotency-Key header so a retry within 24 hours never runs it twice.';
const SET_ID = '00000000-0000-4000-8000-000000000001';

export function docKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${relativePath(path)}`;
}

function relativePath(path: string): string {
  if (path === PROJECT_PREFIX) return '/';
  if (path.startsWith(`${PROJECT_PREFIX}/`)) return path.slice(PROJECT_PREFIX.length);
  return path;
}

const REQUEST_EXAMPLES: Readonly<Record<string, unknown>> = {
  'POST /audits': { prompt_set_id: SET_ID, engines: ['chatgpt'], max_attempts: 12 },
  'POST /audits/estimate': { prompt_set_id: SET_ID, engines: ['chatgpt'] },
};

export const OPERATION_DOCS: Readonly<Record<string, OperationDoc>> = Object.fromEntries(
  OPERATION_TEXT.trim()
    .split('\n')
    .map((line) => {
      const [key = '', summary = '', description = ''] = line.split(' | ');
      const request = REQUEST_EXAMPLES[key];
      return [
        key,
        {
          summary,
          description: description.replace('{key}', IDEMPOTENCY_ADVICE),
          ...(request === undefined ? {} : { request }),
        },
      ];
    }),
);
