'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { PageShell } from '@/components/layout/page-shell';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LegendSwatch } from '@/components/ui/chart';
import type { DataTone } from '@/components/ui/data-tone';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { TrendChart } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
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

/** /prompts/:promptId — one prompt's measurements over time, in one market. */
export function PromptDetailScreen() {
  const { promptId = '' } = useParams();
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const projectId = activeProjectId ?? '';
  const [market, setMarket] = useUrlState('market', optionalStringUrlCodec);
  const markets = useProjectMarkets(projectId, activeWorkspaceId);
  const query = useQuery({
    queryKey: queryKeys.visibility.promptHistory(projectId, promptId, { market }),
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
      <PageShell back={{ href: '/prompts', label: 'Back to Prompts' }}>
        <QueryState
          kind="error"
          {...readErrorProps(query)}
          fallback="This prompt could not be loaded."
        />
      </PageShell>
    );
  if (!activeWorkspaceId)
    return (
      <PageShell>
        <Alert tone="info">Choose a workspace to open this prompt.</Alert>
      </PageShell>
    );
  if (!query.data)
    return (
      <PageShell>
        <QueryState kind="loading" />
      </PageShell>
    );
  const history = query.data;
  return (
    <PageShell
      title={history.prompt.text}
      back={{ href: '/prompts', label: 'Back to Prompts' }}
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
        <PromptAnswerStates latest={history.latest} />
      </Stack>
    </PageShell>
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
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Key label="Mention rate" tone={{ series: 1 }} />
              <Key label="Owned citation rate" tone={{ series: 2 }} />
              {history.implementations.length ? (
                <Key label="Marked implemented" tone={{ series: 6 }} />
              ) : null}
            </ul>
          </Stack>
        ) : (
          <InlineEmpty>No run has measured this prompt in this market yet.</InlineEmpty>
        )}
        <Implementations history={history} />
      </CardContent>
    </Card>
  );
}

function Key({ label, tone }: Readonly<{ label: string; tone: DataTone }>) {
  return (
    <li className="flex items-center gap-2">
      <LegendSwatch tone={tone} />
      <span className={textRole('caption')}>{label}</span>
    </li>
  );
}

/** The Actions measured on this prompt, and when each was marked implemented. */
function Implementations({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  if (!history.implementations.length) return null;
  return (
    <Stack gap="compact" className="pt-4">
      <h3 className={textRole('sectionTitle')}>Work marked implemented</h3>
      <ul className={ledgerClasses('boxed')}>
        {history.implementations.map((item) => (
          <li
            key={`${item.action_id}:${item.implemented_at}`}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="grid gap-0.5">
              <TextLink href={`/agent/actions/${item.action_id}`}>{item.title}</TextLink>
              <span className="type-caption">
                Live from {formatDisplayDate(item.implemented_at, timeZone)}
              </span>
            </div>
            <ActionStatusBadge status={item.status} />
          </li>
        ))}
      </ul>
      <p className="type-caption">
        A marker shows when work went live, not that it changed these rates: other changes and
        answer-engine updates can overlap.
      </p>
    </Stack>
  );
}
