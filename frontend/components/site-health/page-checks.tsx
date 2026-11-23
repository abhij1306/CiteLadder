import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import type { PageDetail } from '@citeladder/contracts';
import { scoreRoleLabels } from '@/lib/site-health/issues';

type Evaluation = PageDetail['evaluations'][number];
type CheckResult = 'failed' | 'not_checked' | 'passed' | 'not_applicable';

const RESULT_ORDER: Record<CheckResult, number> = {
  failed: 0,
  not_checked: 1,
  passed: 2,
  not_applicable: 3,
};

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'check', label: 'Check', kind: 'identity' },
  { key: 'result', label: 'Result', kind: 'status' },
];

function checkResult(outcome: Evaluation['outcome']): CheckResult {
  switch (outcome) {
    case 'satisfied':
      return 'passed';
    case 'partial':
    case 'missing':
      return 'failed';
    case 'unknown':
    case 'error':
      return 'not_checked';
    case 'not_applicable':
      return 'not_applicable';
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

const [WEB_LABEL = '', AEO_LABEL = ''] = scoreRoleLabels(['web_fundamentals', 'aeo_readiness']);

function pillarLabel(pillar: string): string {
  const words = pillar.replaceAll('-', ' ');
  return `${AEO_LABEL} · ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function groupsOf(evaluation: Evaluation): string[] {
  const groups: string[] = [];
  if (evaluation.score_roles.includes('web_fundamentals')) groups.push(WEB_LABEL);
  if (evaluation.aeo_pillar) groups.push(pillarLabel(evaluation.aeo_pillar));
  else if (evaluation.score_roles.includes('aeo_readiness')) groups.push(AEO_LABEL);
  return groups.length ? groups : ['Site'];
}

function checkGroups(evaluations: readonly Evaluation[]) {
  const shown = evaluations
    .filter((evaluation) => evaluation.display_applicability)
    .sort(
      (a, b) =>
        RESULT_ORDER[checkResult(a.outcome)] - RESULT_ORDER[checkResult(b.outcome)] ||
        a.title.localeCompare(b.title),
    );
  const groups = new Map<string, Evaluation[]>();
  for (const evaluation of shown) {
    for (const title of groupsOf(evaluation)) {
      const rows = groups.get(title) ?? [];
      rows.push(evaluation);
      groups.set(title, rows);
    }
  }
  const rank = (title: string) => {
    if (title === 'Web fundamentals') return 0;
    return title === 'Site' ? 2 : 1;
  };
  return [...groups.entries()]
    .map(([title, rows]) => ({ title, rows }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title));
}

function ResultMark({ result }: Readonly<{ result: CheckResult }>) {
  switch (result) {
    case 'passed':
      return (
        <StatusMark variant="status" value="success">
          Passed
        </StatusMark>
      );
    case 'failed':
      return (
        <StatusMark variant="status" value="danger">
          Failed
        </StatusMark>
      );
    case 'not_checked':
      return <StatusMark tone="neutral">Not checked</StatusMark>;
    case 'not_applicable':
      return <StatusMark tone="neutral">Not applicable</StatusMark>;
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

export function PageChecks({ evaluations }: Readonly<{ evaluations: readonly Evaluation[] }>) {
  const groups = checkGroups(evaluations);
  return (
    <TitledSection title="Checks">
      <SectionContent>
        {groups.length === 0 ? (
          <StateBlock kind="empty" inline message="No checks." />
        ) : (
          <Stack gap="workspace">
            {groups.map((group) => (
              <DataTable
                key={group.title}
                title={`${group.title} (${group.rows.length})`}
                columns={COLUMNS}
              >
                {group.rows.map((evaluation) => (
                  <TableRow key={evaluation.id}>
                    <TableCell>
                      <TableCellLines title primary={evaluation.title || evaluation.rule_id} />
                    </TableCell>
                    <TableCell>
                      <ResultMark result={checkResult(evaluation.outcome)} />
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            ))}
          </Stack>
        )}
      </SectionContent>
    </TitledSection>
  );
}
