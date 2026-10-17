'use client';

import type {
  PerceptionCoverage,
  PerceptionQuote,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';
import { MessageSquareQuote } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatGrid } from '@/components/ui/stat-grid';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import { Stack } from '@/components/ui/layout';
import { engineLabel } from '@/lib/visibility/dashboard';
import {
  coverageLine,
  formatNet,
  formatShare,
  stateCopy,
  themeLabel,
} from '@/lib/visibility/perception';
import { usePerception } from '@/lib/visibility/use-perception';
import type { SourceFilters } from '@/components/visibility/source-rows';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';

/**
 * How answers portray the brand and its competitors. Every figure travels with
 * the coverage it was computed over, and a missing classification is a named
 * state, never a zero.
 */
export function VisibilityPerception({
  filters,
  queries,
}: Readonly<{ filters: SourceFilters; queries: SourceQueries }>) {
  const { query, enabled } = usePerception(filters, queries);
  if (query.error)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load perception. Check your connection and try again."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (!enabled) return <PerceptionState state="no_mentions" reason={null} />;
  if (!query.data) return <PerceptionLoading />;
  return (
    <div className="relative">
      <BusyBar active={query.isFetching} label="Updating perception" />
      <PerceptionView data={query.data} />
    </div>
  );
}

function PerceptionLoading() {
  return (
    <Stack gap="workspace" aria-busy>
      <Skeleton className="h-28" />
      <Skeleton className="h-64" />
    </Stack>
  );
}

export function PerceptionView({ data }: Readonly<{ data: PerceptionResponse }>) {
  if (data.state !== 'value')
    return <PerceptionState state={data.state} reason={data.reason} coverage={data.coverage} />;
  return (
    <Stack gap="workspace">
      <Headline data={data} />
      <EntityTable entities={data.entities} />
      <ThemeTable themes={data.themes} />
      <NegativeQuotes quotes={data.negative_quotes} />
      <DriverTable drivers={data.drivers} />
    </Stack>
  );
}

/** A read with no value to show: pending, unavailable with its reason, or no mentions. */
function PerceptionState({
  state,
  reason,
  coverage,
}: Readonly<{
  state: Exclude<PerceptionResponse['state'], 'value'>;
  reason: PerceptionResponse['reason'];
  coverage?: PerceptionCoverage;
}>) {
  const copy = stateCopy(state, reason);
  return (
    <Card>
      <CardContent className="grid gap-2">
        <EmptyState
          variant="compact"
          icon={MessageSquareQuote}
          heading={copy.heading}
          description={copy.description}
        />
        {coverage?.mentions ? <CoverageNote coverage={coverage} /> : null}
      </CardContent>
    </Card>
  );
}

function CoverageNote({ coverage }: Readonly<{ coverage: PerceptionCoverage }>) {
  return <p className={textRole('caption', 'text-muted')}>{coverageLine(coverage)}</p>;
}

function Headline({ data }: Readonly<{ data: PerceptionResponse }>) {
  const score = data.brand?.score;
  const recommended = data.recommended;
  return (
    <Card>
      <CardContent className="grid gap-2">
        <StatGrid
          surface="well"
          columns={4}
          label="Brand perception"
          items={[
            {
              key: 'net',
              label: 'Net sentiment',
              value: formatNet(score?.net_sentiment ?? null),
              missingLabel: 'Unavailable',
              detail: 'Positive minus negative, of classified mentions (−100 to +100).',
            },
            {
              key: 'positive',
              label: 'Positive',
              value: formatShare(score?.positive_share ?? null),
              tone: 'success',
              missingLabel: 'Unavailable',
              detail: `${score?.positive ?? 0} of ${score?.classified ?? 0} classified mentions`,
            },
            {
              key: 'negative',
              label: 'Negative',
              value: formatShare(score?.negative_share ?? null),
              tone: 'danger',
              missingLabel: 'Unavailable',
              detail: `${score?.negative ?? 0} of ${score?.classified ?? 0} classified mentions`,
            },
            {
              key: 'recommended',
              label: 'Recommended',
              value: formatShare(recommended.rate),
              missingLabel: 'Unavailable',
              detail:
                `${recommended.recommended} of ${recommended.mentioned} answers naming you` +
                (recommended.recommended_against
                  ? `; ${recommended.recommended_against} advised against`
                  : ''),
            },
          ]}
        />
        <CoverageNote coverage={data.coverage} />
      </CardContent>
    </Card>
  );
}

function EntityTable({ entities }: Readonly<{ entities: PerceptionResponse['entities'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>You and competitors</CardTitle>
        <CardDescription>
          Classified mentions of each business in the selected answers.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead numeric>Classified</TableHead>
              <TableHead numeric>Positive</TableHead>
              <TableHead numeric>Negative</TableHead>
              <TableHead numeric>Net sentiment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.map((entity) => (
              <TableRow key={entity.name}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2">
                    <ClampText>{entity.name}</ClampText>
                    {entity.is_brand ? (
                      <span className={textRole('caption', 'text-muted shrink-0')}>You</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell numeric>
                  {entity.score.classified} of {entity.coverage.mentions}
                </TableCell>
                <TableCell numeric>{entity.score.positive}</TableCell>
                <TableCell numeric>{entity.score.negative}</TableCell>
                <TableCell numeric>
                  {formatNet(entity.score.net_sentiment) ?? <MissingValue />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ThemeTable({ themes }: Readonly<{ themes: PerceptionResponse['themes'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Themes</CardTitle>
        <CardDescription>
          What answers praised or criticised about you, with a verified quote.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!themes.length ? (
          <InlineEmpty className="p-[var(--card-padding)]">No themes in these answers.</InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Theme</TableHead>
                <TableHead numeric>Positive</TableHead>
                <TableHead numeric>Negative</TableHead>
                <TableHead>Top quote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {themes.map((theme) => (
                <TableRow key={theme.theme}>
                  <TableCell>{themeLabel(theme.theme)}</TableCell>
                  <TableCell numeric>{theme.positive}</TableCell>
                  <TableCell numeric>{theme.negative}</TableCell>
                  <TableCell>
                    {theme.quotes[0] ? (
                      <ClampText tooltip={`“${theme.quotes[0].text}”`}>
                        <QuoteLink quote={theme.quotes[0]} />
                      </ClampText>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function QuoteLink({ quote }: Readonly<{ quote: PerceptionQuote }>) {
  return (
    <TextLink href={`/runs/${quote.run_id}?execution=${quote.execution_id}`}>
      “{quote.text}”
    </TextLink>
  );
}

function NegativeQuotes({ quotes }: Readonly<{ quotes: PerceptionQuote[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Criticism in answers</CardTitle>
        <CardDescription>
          Negative points about you, quoted exactly as the answer put them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!quotes.length ? (
          <InlineEmpty>No negative points about you in these answers.</InlineEmpty>
        ) : (
          <ul className="grid gap-3">
            {quotes.map((quote) => (
              <li key={`${quote.execution_id}:${quote.text}`} className="grid gap-1">
                <QuoteLink quote={quote} />
                <span
                  className={textRole('caption', 'text-muted flex flex-wrap items-center gap-2')}
                >
                  <Badge variant="sentiment" value="negative">
                    {themeLabel(quote.theme)}
                  </Badge>
                  {engineLabel(quote.logical_engine)} · {quote.prompt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DriverTable({ drivers }: Readonly<{ drivers: PerceptionResponse['drivers'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources cited alongside criticism</CardTitle>
        <CardDescription>
          Domains cited in answers that criticised you. Cited alongside, not shown to be the cause.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!drivers.length ? (
          <InlineEmpty className="p-[var(--card-padding)]">
            No sources cited alongside criticism.
          </InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead numeric>Answers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((driver) => (
                <TableRow key={driver.domain}>
                  <TableCell>{driver.domain}</TableCell>
                  <TableCell numeric>{driver.answers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
