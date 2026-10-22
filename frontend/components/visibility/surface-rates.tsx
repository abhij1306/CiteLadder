'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadError } from '@/components/ui/read-error';
import { StatRow, type StatSegment } from '@/components/ui/stat-row';
import { MissingValue } from '@/components/ui/unavailable-value';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses, SubsectionHeader } from '@/components/ui/workspace';
import type { AioRate, SurfaceRates } from '@/lib/api/types';

/**
 * The five AI Overview rates, each shown with what it divided by.
 *
 * These answer different questions and are easy to confuse. With 100
 * successful observations, 40 overviews and 10 naming the brand: the trigger
 * rate is 40%, the conditional mention rate is 25%, and overall visibility is
 * 10%. All three are true and none of them alone is "how visible are we", so
 * every tile here states its denominator in words underneath the number.
 *
 * A rate with nothing to divide is UNAVAILABLE, never 0%. A zero would be a
 * measurement claim nobody made.
 */

// The template already supplies the "of" between the two numbers, so each
// value here starts at the noun. Carrying a second "of" rendered every tile
// as "40 of 100 of searches we successfully observed".
const DENOMINATOR_COPY: Record<string, string> = {
  successful_observations: 'searches we successfully observed',
  observations_with_ai_overview: 'searches that showed an overview',
};

/** A rate's value as a percentage to one decimal place. */
function ratePercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function denominatorCopy(rate: AioRate): string {
  const scope = DENOMINATOR_COPY[rate.denominator_kind] ?? 'observations counted';
  return `${rate.numerator} of ${rate.denominator} ${scope}`;
}

/**
 * One rate as a stat: the figure, what it divided by, and what it means. A rate
 * with nothing to divide is the missing mark named "Unavailable", never 0%.
 */
function rateStat({
  key,
  label,
  caption,
  rate,
}: Readonly<{ key: string; label: string; caption: string; rate: AioRate }>): StatSegment {
  return {
    key,
    label,
    value: rate.value === null ? null : ratePercent(rate.value),
    missingLabel: 'Unavailable',
    sub: (
      <>
        <span className="block">
          {rate.value === null
            ? 'Nothing to divide by yet — no observation has entered this denominator.'
            : denominatorCopy(rate)}
        </span>
        <span className="block">{caption}</span>
      </>
    ),
  };
}

function CompetitorRates({ rates }: Readonly<{ rates: SurfaceRates['competitor_mention_rates'] }>) {
  if (rates.length === 0) return null;
  return (
    <Stack as="section" gap="item">
      <SubsectionHeader
        title="Competitors, when an overview appeared"
        description="Over the same denominator as your own conditional mention rate, so the two are comparable."
      />
      <ul className={ledgerClasses('open')}>
        {rates.map((entry) => (
          <Inline
            as="li"
            gap="compact"
            key={entry.name}
            className={ledgerItemClasses('justify-between')}
          >
            <span className={textRole('body', 'min-w-0 truncate')}>{entry.name}</span>
            <Inline as="span" className="shrink-0">
              {entry.rate.value === null ? (
                <MissingValue state="unavailable" className="type-body" />
              ) : (
                <>
                  <span className="type-body tabular-nums">{ratePercent(entry.rate.value)}</span>
                  {/* The denominator is stated once for the list above; the
                      numerator is not, and it is what separates one competitor
                      named in a single overview from one named in fifty. */}
                  <span className="type-caption tabular-nums">
                    {`${entry.rate.numerator} of ${entry.rate.denominator}`}
                  </span>
                </>
              )}
            </Inline>
          </Inline>
        ))}
      </ul>
    </Stack>
  );
}

export function SurfaceRatesPanel({
  query,
}: Readonly<{ query: UseQueryResult<SurfaceRates, unknown> }>) {
  const data = query.data;
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load the AI Overview rates."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (!data) return <QueryState kind="loading" label="Loading AI Overview rates…" />;
  // These rates are RETAINED across a surface or run change, the same way
  // the sources and evidence panels retain theirs, so the reader is not
  // handed a skeleton for every round trip. Retained numbers carry no
  // shape of their own to recognise, though -- five percentages look
  // equally plausible under any selection -- so the busy bar every other
  // retaining panel shows is what keeps them from reading as settled.
  return (
    <Card className="relative" aria-busy={query.isFetching}>
      <BusyBar active={query.isFetching} label="Updating AI Overview rates" />
      <CardHeader>
        <CardTitle>Google AI Overview</CardTitle>
        <CardDescription>
          {`${data.successful} successfully observed ${data.successful === 1 ? 'search' : 'searches'}, ${data.with_overview} of which showed an overview. Each rate below states what it divided by.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="workspace">
          <div className="border-border-subtle border-b">
            <StatRow
              segments={[
                rateStat({
                  key: 'trigger',
                  label: 'Overview shown',
                  caption:
                    'A property of the QUERIES, not of your brand. It moves when Google changes what it answers with.',
                  rate: data.trigger_rate,
                }),
                rateStat({
                  key: 'named',
                  label: 'Named, when shown',
                  caption:
                    'Conditional. It can rise while overall visibility falls, if Google shows fewer overviews but names you in more of them.',
                  rate: data.brand_mention_rate_when_present,
                }),
                rateStat({
                  key: 'overall',
                  label: 'Overall visibility',
                  caption:
                    "Unconditional, and the closest to 'how visible are we here'. A search with no overview counts against it.",
                  rate: data.overall_brand_visibility,
                }),
                rateStat({
                  key: 'cited',
                  label: 'Your site cited',
                  caption:
                    'Independent of being named: an overview can name you without citing you, and cite you without naming you.',
                  rate: data.owned_citation_rate_when_present,
                }),
              ]}
            />
          </div>
          <CompetitorRates rates={data.competitor_mention_rates} />
        </Stack>
      </CardContent>
    </Card>
  );
}
