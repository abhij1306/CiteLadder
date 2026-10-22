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
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/ui/stat-row';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
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
      <Skeleton shape="block" />
      <Skeleton shape="chart" />
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
      <CardContent>
        <Stack gap="item">
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={MessageSquareQuote}
            heading={copy.heading}
            description={copy.description}
          />
          {coverage?.mentions ? <CoverageNote coverage={coverage} /> : null}
        </Stack>
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
      <CardContent>
        <Stack gap="item">
          <StatRow
            label="Brand perception"
            segments={[
              {
                key: 'net',
                label: 'Net sentiment',
                value: formatNet(score?.net_sentiment ?? null),
                missingLabel: 'Unavailable',
                sub: 'Positive minus negative, of classified mentions (−100 to +100).',
              },
              {
                key: 'positive',
                label: 'Positive',
                value: formatShare(score?.positive_share ?? null),
                tone: 'success',
                missingLabel: 'Unavailable',
                sub: `${score?.positive ?? 0} of ${score?.classified ?? 0} classified mentions`,
              },
              {
                key: 'negative',
                label: 'Negative',
                value: formatShare(score?.negative_share ?? null),
                tone: 'danger',
                missingLabel: 'Unavailable',
                sub: `${score?.negative ?? 0} of ${score?.classified ?? 0} classified mentions`,
              },
              {
                key: 'recommended',
                label: 'Recommended',
                value: formatShare(recommended.rate),
                missingLabel: 'Unavailable',
                sub:
                  `${recommended.recommended} of ${recommended.mentioned} answers naming you` +
                  (recommended.recommended_against
                    ? `; ${recommended.recommended_against} advised against`
                    : ''),
              },
            ]}
          />
          <CoverageNote coverage={data.coverage} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function EntityTable({ entities }: Readonly<{ entities: PerceptionResponse['entities'] }>) {
  return (
    <DataTable
      title="You and competitors"
      columns={ENTITY_COLUMNS}
      footer="Classified mentions of each business in the selected answers."
    >
      {entities.map((entity) => (
        <TableRow key={entity.name}>
          <TableCell>
            <Inline as="span">
              <ClampText>{entity.name}</ClampText>
              {entity.is_brand ? (
                <span className={textRole('caption', 'text-muted shrink-0')}>You</span>
              ) : null}
            </Inline>
          </TableCell>
          <TableCell numeric>
            {entity.score.classified} of {entity.coverage.mentions}
          </TableCell>
          <TableCell numeric>{entity.score.positive}</TableCell>
          <TableCell numeric>{entity.score.negative}</TableCell>
          <TableCell numeric>{formatNet(entity.score.net_sentiment) ?? <MissingValue />}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const ENTITY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'business', label: 'Business' },
  { key: 'classified', label: 'Classified', width: 'figure', numeric: true },
  { key: 'positive', label: 'Positive', width: 'figure', numeric: true },
  { key: 'negative', label: 'Negative', width: 'figure', numeric: true },
  { key: 'net', label: 'Net sentiment', width: 'figure', numeric: true },
];

const THEME_COLUMNS: readonly DataTableColumn[] = [
  { key: 'theme', label: 'Theme', width: 'name' },
  { key: 'positive', label: 'Positive', width: 'figure', numeric: true },
  { key: 'negative', label: 'Negative', width: 'figure', numeric: true },
  { key: 'quote', label: 'Top quote' },
];

function noneHere(heading: string): DataTableState {
  return { kind: 'empty', headingLevel: 3, icon: MessageSquareQuote, heading };
}

function ThemeTable({ themes }: Readonly<{ themes: PerceptionResponse['themes'] }>) {
  return (
    <DataTable
      title="Themes"
      columns={THEME_COLUMNS}
      footer="What answers praised or criticised about you, with a verified quote."
      state={themes.length ? undefined : noneHere('No themes in these answers.')}
    >
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
    </DataTable>
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
          <QueryState
            kind="empty"
            inline
            message="No negative points about you in these answers."
          />
        ) : (
          <Stack as="ul">
            {quotes.map((quote) => (
              <Stack as="li" gap="tight" key={`${quote.execution_id}:${quote.text}`}>
                <QuoteLink quote={quote} />
                <Inline as="span" className={textRole('caption', 'text-muted flex-wrap')}>
                  <Badge variant="sentiment" value="negative">
                    {themeLabel(quote.theme)}
                  </Badge>
                  {engineLabel(quote.logical_engine)} · {quote.prompt}
                </Inline>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function DriverTable({ drivers }: Readonly<{ drivers: PerceptionResponse['drivers'] }>) {
  return (
    <DataTable
      title="Sources cited alongside criticism"
      columns={[
        { key: 'domain', label: 'Domain' },
        { key: 'answers', label: 'Answers', width: 'figure', numeric: true },
      ]}
      footer="Domains cited in answers that criticised you. Cited alongside, not shown to be the cause."
      state={drivers.length ? undefined : noneHere('No sources cited alongside criticism.')}
    >
      {drivers.map((driver) => (
        <TableRow key={driver.domain}>
          <TableCell>{driver.domain}</TableCell>
          <TableCell numeric>{driver.answers}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
