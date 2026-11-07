import { useQuery } from '@tanstack/react-query';
import { aiTrafficQueries } from '@/lib/api/ai-traffic';
import { projectDestination } from '@/lib/navigation/project-destination';
import { Callout } from '@/components/ui/callout';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { TrafficUrlButton } from './url-panel';
import { patternLabel } from '@/lib/ai-traffic/vocabulary';

/** Nothing observed is a measured absence only when both sources were complete. */
function nothingObservedLine(coverage: Readonly<{ crawl: string; ga4_complete: boolean }>) {
  return coverage.crawl === 'complete' && coverage.ga4_complete
    ? 'No patterns were observed in this window.'
    : 'No patterns were observed in the data covered so far; coverage is incomplete.';
}

export function InsightStrip({
  projectId,
  workspaceId,
  range,
}: Readonly<{ projectId: string; workspaceId: string; range: string }>) {
  const query = useQuery({
    ...aiTrafficQueries.insights({ workspaceId, projectId }, range),
    enabled: !!projectId && !!workspaceId,
  });
  const data = query.isError ? undefined : query.data;
  // The card keeps its slot when nothing was observed: dropping it after the
  // loading line would pull the Overview content up under the reader.
  const nothingObserved = data !== undefined && !data.patterns.length && !data.coverage.notice;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Observed patterns</CardTitle>
      </CardHeader>
      <Stack>
        {query.isError ? (
          <ReadError {...readErrorProps(query)} fallback="Could not read insights" />
        ) : null}
        {query.isLoading ? (
          <p className="type-body text-ink-secondary">Loading persisted insights…</p>
        ) : null}
        {nothingObserved ? (
          <p className="type-body text-ink-secondary">{nothingObservedLine(data.coverage)}</p>
        ) : null}
        {data?.coverage.notice ? <Callout tone="info">{data.coverage.notice}</Callout> : null}
        {data ? (
          <p className="type-caption">
            {data.window_start} – {data.window_end} · Co-occurrence only. AI apps can strip
            referrers.
          </p>
        ) : null}
        {data?.patterns.length ? (
          <ul className={ledgerClasses()}>
            {data.patterns.map((r) => (
              <Stack as="li" key={r.pattern} className={ledgerItemClasses()}>
                <p className="type-body">{r.copy}</p>
                <Inline gap="meta">
                  <TextLink
                    aria-label={`Inspect pages: ${patternLabel(r.pattern)}`}
                    href={projectDestination(
                      '/ai-traffic',
                      new URLSearchParams({
                        tab: 'pages',
                        range,
                        sort:
                          r.pattern === 'key_event_concentration'
                            ? 'key_events_desc'
                            : 'requests_desc',
                        pattern: r.pattern,
                      }),
                      projectId,
                    )}
                  >
                    Inspect pages
                  </TextLink>
                  {r.url_hashes.slice(0, 3).map((hash, index) => (
                    <TrafficUrlButton
                      key={hash}
                      urlHash={hash}
                      label={`Inspect page ${index + 1}: ${patternLabel(r.pattern)}`}
                      filters={{ start_date: data.window_start, end_date: data.window_end }}
                    >
                      Inspect page {index + 1}
                    </TrafficUrlButton>
                  ))}
                </Inline>
              </Stack>
            ))}
          </ul>
        ) : null}
      </Stack>
    </Card>
  );
}
