import { useState } from 'react';

import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { engineOptionMark } from '@/components/ui/engine-mark';
import { useEngineCatalog } from '@/lib/providers/engines';
import { EXECUTION_STATES } from '@/lib/runs/status';
import type { Execution, ExecutionStatus } from '@citeladder/contracts';

const ALL = 'all';

function distinct<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function useExecutionFilters(executions: readonly Execution[]): Readonly<{
  definitions: readonly FilterDefinition[];
  rows: readonly Execution[];
  key: string;
}> {
  const catalog = useEngineCatalog();
  const [engineChoice, setEngineChoice] = useState<string>(ALL);
  const [statusChoice, setStatusChoice] = useState<ExecutionStatus | typeof ALL>(ALL);
  const engines = distinct(executions.map((execution) => execution.logical_engine));
  const statuses = distinct(executions.map((execution) => execution.status));
  const engine = engines.includes(engineChoice) ? engineChoice : ALL;
  const status = statusChoice !== ALL && statuses.includes(statusChoice) ? statusChoice : ALL;
  return {
    definitions: [
      choiceFilter({
        id: 'engine',
        label: 'Engine',
        icon: 'engines',
        value: engine,
        defaultValue: ALL,
        groups: [
          {
            options: [
              { value: ALL, label: 'All engines' },
              ...engines.map((value) => ({
                value,
                label: catalog.label(value),
                mark: engineOptionMark(value),
              })),
            ],
          },
        ],
        onChange: setEngineChoice,
      }),
      choiceFilter<ExecutionStatus | typeof ALL>({
        id: 'status',
        label: 'Status',
        value: status,
        defaultValue: ALL,
        groups: [
          {
            options: [
              { value: ALL, label: 'All statuses' },
              ...statuses.map((value) => ({ value, label: EXECUTION_STATES[value].label })),
            ],
          },
        ],
        onChange: setStatusChoice,
      }),
    ],
    rows: executions.filter(
      (execution) =>
        (engine === ALL || execution.logical_engine === engine) &&
        (status === ALL || execution.status === status),
    ),
    key: `${engine}:${status}`,
  };
}
