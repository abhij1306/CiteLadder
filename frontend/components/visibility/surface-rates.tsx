import type { UseQueryResult } from '@tanstack/react-query';

import { BusyRung } from '@/components/ui/rung-meter';
import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { Inline, Stack } from '@/components/ui/layout';
import { SubsectionHeader } from '@/components/ui/workspace';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { formatPercent } from '@/lib/format';
import type { AioRate, SurfaceRates } from '@citeladder/contracts';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';

const DENOMINATOR_COPY: Record<string, string> = {
  successful_observations: 'searches we successfully observed',
  observations_with_ai_overview: 'searches that showed an overview',
};

function denominatorCopy(rate: AioRate): string {
  const scope = DENOMINATOR_COPY[rate.denominator_kind] ?? 'observations counted';
  return `${rate.numerator} of ${rate.denominator} ${scope}`;
}

function rateStat({
  key,
  label,
  rate,
}: Readonly<{ key: string; label: string; rate: AioRate }>): FigureSegment {
  return {
    key,
    label,
    value: rate.value === null ? null : formatPercent(rate.value),
    missingState: 'unavailable',
    sub: rate.value === null ? undefined : denominatorCopy(rate),
  };
}

function CompetitorRates({ rates }: Readonly<{ rates: SurfaceRates['competitor_mention_rates'] }>) {
  if (rates.length === 0) return null;
  return (
    <Stack as="section" gap="item">
      <SubsectionHeader title="Competitors, when an overview appeared" />
      <LedgerList label="Competitors, when an overview appeared">
        {rates.map((entry) => (
          <LedgerItem
            key={entry.name}
            title={
              <Inline as="span">
                <BrandMark
                  name={entry.name}
                  logoUrl={entry.logo_url}
                  websiteUrl={entry.website_url}
                />
                {entry.name}
              </Inline>
            }
            meta={
              entry.rate.value === null ? (
                <Absence state="unavailable" className="type-body text-ink-2" />
              ) : (
                <>
                  <span className="type-body tabular-nums">{formatPercent(entry.rate.value)}</span>
                  <span className="type-caption tabular-nums">
                    {`${entry.rate.numerator} of ${entry.rate.denominator}`}
                  </span>
                </>
              )
            }
          />
        ))}
      </LedgerList>
    </Stack>
  );
}

export function SurfaceRatesPanel({
  query,
}: Readonly<{ query: UseQueryResult<SurfaceRates, unknown> }>) {
  const data = query.data;
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load the AI Overview rates"
        fallback="The request failed or timed out."
      />
    );
  if (!data)
    return (
      <StateBlock
        kind="loading"
        label="Loading AI Overview rates…"
        shape={{ kind: 'figures', count: 4 }}
      />
    );
  return (
    <Section className="relative" aria-busy={query.isFetching}>
      <BusyRung active={query.isFetching} label="Updating AI Overview rates" />
      <SectionHeader>
        <SectionTitle>Google AI Overview</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <Stack gap="workspace">
          <FigureStrip
            segments={[
              rateStat({ key: 'trigger', label: 'Overview shown', rate: data.trigger_rate }),
              rateStat({
                key: 'named',
                label: 'Named, when shown',
                rate: data.brand_mention_rate_when_present,
              }),
              rateStat({
                key: 'overall',
                label: 'Overall visibility',
                rate: data.overall_brand_visibility,
              }),
              rateStat({
                key: 'cited',
                label: 'Your site cited',
                rate: data.owned_citation_rate_when_present,
              }),
            ]}
          />
          <CompetitorRates rates={data.competitor_mention_rates} />
        </Stack>
      </SectionContent>
    </Section>
  );
}
