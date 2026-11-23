import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { ClampText } from '@/components/ui/clamp-text';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Disclosure } from '@/components/ui/disclosure';
import { Stack } from '@/components/ui/layout';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { AreaChart } from '@/components/ui/area-chart';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayDate, formatPercent, formattedText } from '@/lib/format';
import {
  implementationEvents,
  mentionRatePoints,
  ownedCitationValues,
} from '@/lib/prompts/history';
import { formatWholePercent } from '@/lib/visibility/dashboard';
import type { PromptHistory } from '@citeladder/contracts';

import { NO_ANSWERS, NOT_MEASURED } from './prompt-figures';

function ownedRate(point: PromptHistory['points'][number]) {
  if (point.owned_citation_rate !== null) return formatPercent(point.owned_citation_rate);
  return point.counts.responses === 0 ? NO_ANSWERS : NOT_MEASURED;
}

export function PromptTrend({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  const { points } = history;
  return (
    <TitledSection title="Trend">
      <SectionContent>
        <Stack gap="workspace">
          <AreaChart
            label="Visibility over time"
            name="Visibility"
            data={mentionRatePoints(points, timeZone)}
            series={[{ label: 'Owned citation rate', values: ownedCitationValues(points) }]}
            events={implementationEvents(history.implementations, timeZone)}
            eventsLabel="Marked implemented"
            yMax={100}
            yFormat={(value) => formattedText(formatWholePercent(value))}
            lonePoint="plot"
          />
          <RunData points={points} />
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

function RunData({ points }: Readonly<{ points: PromptHistory['points'] }>) {
  const timeZone = useDisplayTimeZone();
  return (
    <Disclosure title={`Show run data (${formatCount(points.length)})`}>
      <DataTable label="Runs that measured this prompt" columns={RUN_DATA_COLUMNS}>
        {[...points].reverse().map((point) => (
          <TableRow key={point.audit_id}>
            <TableCell>
              <TableCellLines
                primary={formatDisplayDate(point.completed_at, timeZone)}
                secondary={point.comparable_with_previous === false ? 'New conditions' : undefined}
              />
            </TableCell>
            <TableCell numeric>
              {point.mention_rate === null ? NO_ANSWERS : formatPercent(point.mention_rate)}
            </TableCell>
            <TableCell numeric>{ownedRate(point)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Disclosure>
  );
}

const RUN_DATA_COLUMNS: readonly DataTableColumn[] = [
  { key: 'date', label: 'Run date', kind: 'identity' },
  { key: 'visibility', label: 'Visibility', width: 'figure', kind: 'number' },
  { key: 'owned', label: 'Owned rate', width: 'figure', kind: 'number' },
];

export function PromptImplementations({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  if (!history.implementations.length) return null;
  return (
    <DataTable title="Work marked implemented" columns={IMPLEMENTATION_COLUMNS}>
      {history.implementations.map((item) => (
        <TableRow key={`${item.action_id}:${item.implemented_at}`}>
          <TableCell>
            <ClampText tooltip={item.title}>
              <TextLink href={`/actions/${item.action_id}`} text="inherit">
                {item.title}
              </TextLink>
            </ClampText>
          </TableCell>
          <TableCell>{formatDisplayDate(item.implemented_at, timeZone)}</TableCell>
          <TableCell>
            <ActionStatusBadge status={item.status} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const IMPLEMENTATION_COLUMNS: readonly DataTableColumn[] = [
  { key: 'action', label: 'Action', kind: 'identity' },
  { key: 'live', label: 'Live from', width: 'date', kind: 'date' },
  { key: 'status', label: 'Status', width: 'status' },
];
