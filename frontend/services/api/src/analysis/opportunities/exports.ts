import { tableCsv } from '../../http/table-export.ts';

const columns = [
  'id',
  'rule_id',
  'opportunity_type',
  'severity',
  'priority_score',
  'title',
  'target',
  'remediation',
  'rule_version',
  'formula_version',
  'created_at',
];

export const rowsToCsv = (items: Record<string, unknown>[], selectedColumns = columns) =>
  tableCsv(selectedColumns, items);
