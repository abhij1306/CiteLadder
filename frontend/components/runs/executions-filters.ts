import { useState } from 'react';

import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import { useEngineCatalog } from '@/lib/providers/engines';
import { EXECUTION_STATES } from '@/lib/runs/status';
import type { Execution, ExecutionStatus } from '@citeladder/contracts';

const ALL = 'all';

/** The values a column holds across the run, each once, in first-seen order. */
function distinct<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * The executions table's Engine and Status filters, over the run's whole list
 * (it arrives in one read). Each offers only what the run holds. A choice the
 * list no longer carries (a status every row has left) reads as unfiltered.
 */
export function useExecutionFilters(executions: readonly Execution[]): Readonly<{
  definitions: readonly FilterDefinition[];
  rows: readonly Execution[];
  /** Changes whenever the filtered set does, so a pager can return to its first page. */
  key: string;
}> {
  const catalog = useEngineCatalog();
  const [engineChoice, setEngine] = useState<string>(ALL);
  const [statusChoice, setStatus] = useState<ExecutionStatus | typeof ALL>(ALL);
  const engines = distinct(executions.map((execution) => execution.logical_engine));
  const statuses = distinct(executions.map((execution) => execution.status));
  const engine = engines.includes(engineChoice) ? engineChoice : ALL;
  const status = statusChoice !== ALL && statuses.includes(statusChoice) ? statusChoice : ALL;
  return {
    definitions: [
      choiceFilter({
        id: 'engine',
        label: 'Engine',
        value: engine,
        defaultValue: ALL,
        groups: [
          {
            options: [
              { value: ALL, label: 'All engines' },
              ...engines.map((value) => ({ value, label: catalog.label(value) })),
            ],
          },
        ],
        onChange: setEngine,
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
        onChange: setStatus,
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
