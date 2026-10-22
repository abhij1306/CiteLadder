'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { DetailScreen } from '@/components/layout/page-shell';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartKey } from '@/components/ui/chart';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { TrendChart } from '@/components/ui/trend-chart';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { MarketFilter } from '@/components/visibility/visibility-toolbar';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate } from '@/lib/format';
import { formatWholePercent } from '@/lib/visibility/dashboard';
import { queryKeys } from '@/lib/api/query-keys';
import type { PromptHistory } from '@/lib/api/types';
import { visibilityApi } from '@/lib/api/visibility';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';
import { useProjectMarkets } from '@/lib/project/use-project-markets';
import {
  implementationEvents,
  mentionRatePoints,
  ownedCitationValues,
} from '@/lib/prompts/history';

import { PromptAnswerStates } from './prompt-answer-states';

const BACK = { href: '/prompts', label: 'Back to Prompts' } as const;

/** /prompts/:promptId — one prompt's measurements over time, in one market. */
export function PromptDetailScreen() {
  const { promptId = '' } = useParams();
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const projectId = activeProjectId ?? '';
  const [market, setMarket] = useUrlState('market', optionalStringUrlCodec);
  const markets = useProjectMarkets(projectId, activeWorkspaceId);
  const query = useQuery({
    queryKey: queryKeys.visibility.promptHistory(projectId, promptId, {
      market,
    }),
    queryFn: ({ signal }) =>
      visibilityApi.getPromptHistory(
        projectId,
        promptId,
        { market: market ?? undefined },
        { signal, workspaceId: activeWorkspaceId },
      ),
    enabled: Boolean(projectId && activeWorkspaceId && promptId),
  });

  if (query.isError)
    return (
      <DetailScreen back={BACK}>
        <QueryState
          kind="error"
          {...readErrorProps(query)}
          fallback="This prompt could not be loaded."
        />
      </DetailScreen>
    );
  if (!activeWorkspaceId)
    return (
      <DetailScreen back={BACK}>
        <Alert tone="info">Choose a workspace to open this prompt.</Alert>
      </DetailScreen>
    );
  if (!query.data)
    return (
      <DetailScreen back={BACK}>
        <QueryState kind="loading" />
      </DetailScreen>
    );
  const history = query.data;
  return (
    <DetailScreen
      title={history.prompt.text}
      back={BACK}
      // A single market has nothing to choose, so the band is not drawn empty.
      controls={
        markets.length > 1
          ? {
              filters: (
                <MarketFilter
                  markets={markets}
                  market={market}
                  onChangeMarket={(next) => setMarket(next)}
                />
              ),
            }
          : undefined
      }
    >
      <Stack gap="section" aria-busy={query.isFetching}>
        <HistoryCard history={history} />
        <Implementations history={history} />
        <PromptAnswerStates latest={history.latest} />
      </Stack>
    </DetailScreen>
  );
}

// Tailwind's `lg`, where Visibility splits its chart into a half-width pane.
const WIDE_VIEWPORT_QUERY = '(min-width: 64rem)';

function subscribeWideViewport(notify: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return () => undefined;
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

function isWideViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_VIEWPORT_QUERY).matches
    : false;
}

/** Mention and owned-citation rates per run, with declared work marked. */
function HistoryCard({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  const data = mentionRatePoints(history.points, timeZone);
  const wide = useSyncExternalStore(subscribeWideViewport, isWideViewport, () => false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Over time</CardTitle>
        <CardDescription>
          Each point is one run that measured this prompt. A run with no successful answer is a gap,
          and a change in measurement conditions starts a new line.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <Stack gap="compact">
            <TrendChart
              label="Mention rate over time"
              data={data}
              series={[
                {
                  label: 'Owned citation rate',
                  values: ownedCitationValues(history.points),
                  strokeClass: 'stroke-chart-2',
                },
              ]}
              events={implementationEvents(history.implementations, timeZone)}
              // The viewBox scales to the card, so its text does too. On wide
              // screens this card spans the page where Visibility's chart spans
              // half, and a 360-wide viewBox drew text twice Visibility's size;
              // below `lg` both span the card and share the 360 width.
              width={wide ? 720 : 360}
              height={168}
              xAxisLabel="Run date"
              yAxisLabel="Rate (%)"
              formatTick={formatWholePercent}
              className="h-auto w-full"
            />
            <ChartKey
              entries={[
                { label: 'Mention rate', tone: { series: 1 } },
                { label: 'Owned citation rate', tone: { series: 2 } },
                ...(history.implementations.length
                  ? [{ label: 'Marked implemented', tone: { series: 6 } } as const]
                  : []),
              ]}
            />
          </Stack>
        ) : (
          <QueryState
            kind="empty"
            inline
            message="No run has measured this prompt in this market yet."
          />
        )}
      </CardContent>
    </Card>
  );
}

/** The Actions measured on this prompt, and when each was marked implemented. */
function Implementations({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  if (!history.implementations.length) return null;
  return (
    <DataTable
      title="Work marked implemented"
      columns={IMPLEMENTATION_COLUMNS}
      footer={
        <p className="type-caption">
          A marker shows when work went live, not that it changed these rates: other changes and
          answer-engine updates can overlap.
        </p>
      }
    >
      {history.implementations.map((item) => (
        <TableRow key={`${item.action_id}:${item.implemented_at}`}>
          <TableCell>
            <ClampText lines={1} tooltip={item.title}>
              <TextLink href={`/agent/actions/${item.action_id}`}>{item.title}</TextLink>
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
  { key: 'action', label: 'Action' },
  { key: 'live', label: 'Live from', width: 'date' },
  { key: 'status', label: 'Status', width: 'status' },
];
