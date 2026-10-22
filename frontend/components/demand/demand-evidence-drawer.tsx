'use client';

import type { ReactNode } from 'react';
import { ProjectLink } from '@/components/layout/scoped-link';
import { ArrowUpRight, ShieldCheck, Split } from 'lucide-react';

import { SignalInsight } from '@/components/demand/demand-signal-insight';
import { SignalChip } from '@/components/demand/demand-signal-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { StatRow } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import type { DemandSignal } from '@/lib/api/demand';
import {
  competingPages,
  demandSignalHandoffHref,
  numericMetric,
  safePageUrl,
  signalTarget,
  signalTargetKind,
} from '@/lib/demand/signals';
import { DisplayTime } from '@/components/ui/display-time';
import { formatCount, formatPercent } from '@/lib/format';
import { textRole } from '@/components/ui/typography';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { ledgerClasses } from '@/components/ui/workspace';

export function DemandEvidenceDrawer({
  signal,
  open,
  onOpenChange,
}: Readonly<{
  signal: DemandSignal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  if (!signal) return null;
  return <DemandEvidenceContent signal={signal} open={open} onOpenChange={onOpenChange} />;
}

function DemandEvidenceContent({
  signal,
  open,
  onOpenChange,
}: Readonly<{
  signal: DemandSignal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const details = demandEvidenceDetails(signal);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Signal evidence"
      className="desktop:max-w-lg max-w-md"
      footer={
        <div className="flex flex-wrap items-center justify-between">
          <Button variant="secondary" asChild>
            <ProjectLink
              href={demandSignalHandoffHref(signal)}
              className="inline-flex items-center"
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
              Ask agent
            </ProjectLink>
          </Button>
        </div>
      }
    >
      <Stack gap="workspace">
        <Stack className="border-border-subtle border-b pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{details.targetKind}</Badge>
            <SignalChip signalType={signal.signal_type} />
          </div>
          <h2 className={textRole('sectionTitle', 'break-words')}>{details.target}</h2>
          {details.linkablePageUrl && (
            <div className="type-caption flex items-center gap-2">
              <span className={textRole('emphasis', 'shrink-0')}>Landing page</span>
              <TextLink
                variant="external"
                text="inherit"
                href={details.linkablePageUrl}
                className="min-w-0"
              >
                <span className="truncate">{details.linkablePageUrl}</span>
              </TextLink>
            </div>
          )}
        </Stack>

        <SignalInsight signal={signal} />

        <Stack as="section">
          <h3 className={textRole('label')}>Search Console performance</h3>
          <StatRow
            segments={[
              {
                key: 'impressions',
                label: 'Impressions',
                value:
                  typeof details.metrics.impressions === 'number'
                    ? formatCount(details.metrics.impressions)
                    : null,
              },
              {
                key: 'clicks',
                label: 'Clicks',
                value:
                  typeof details.metrics.clicks === 'number'
                    ? formatCount(details.metrics.clicks)
                    : null,
              },
              {
                key: 'ctr',
                label: 'CTR',
                value:
                  typeof details.metrics.ctr === 'number'
                    ? formatPercent(details.metrics.ctr, 1)
                    : null,
              },
              {
                key: 'position',
                label: 'Avg. position',
                value:
                  typeof details.metrics.position === 'number'
                    ? details.metrics.position.toFixed(1)
                    : null,
              },
            ]}
          />
        </Stack>

        {/* Cannibalization only. Bounded by the rule itself: each competing
            page holds at least a 10% share, so there are never more than 10. */}
        {details.pages.length > 0 && (
          <Stack as="section">
            <h3 className={textRole('label', 'flex items-center gap-2')}>
              <Split className="text-muted size-3.5" aria-hidden />
              Competing pages ({details.pages.length})
            </h3>
            <div className={ledgerClasses('boxed')}>
              {details.pages.map((page) => (
                <Stack key={page.url} gap="tight" className="type-caption p-3">
                  <div className={textRole('emphasis', 'text-foreground break-all')}>
                    {page.url}
                  </div>
                  <div className="type-caption flex items-center justify-between">
                    <span>{formatCount(page.impressions)} impressions</span>
                    <span className={textRole('emphasis', 'text-foreground tabular-nums')}>
                      {(page.share * 100).toFixed(0)}% query share
                    </span>
                  </div>
                </Stack>
              ))}
            </div>
          </Stack>
        )}

        {details.cohortMedianCtr !== null && (
          <Stack as="section">
            <h3 className={textRole('label')}>Position benchmark</h3>
            <Stack className={panelClasses({}, 'type-caption')}>
              <div className="flex justify-between">
                <span className="text-muted">Position band</span>
                {details.positionBand !== null ? (
                  <span className={textRole('emphasis', 'text-foreground')}>
                    Positions {details.positionBand}.0 – {details.positionBand}.9
                  </span>
                ) : (
                  <UnavailableValue state="not_measured" />
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Median CTR in this band</span>
                <span className={textRole('emphasis', 'text-secondary tabular-nums')}>
                  {formatPercent(details.cohortMedianCtr, 1)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">This query’s CTR</span>
                {numericMetric(signal, 'ctr') !== null ? (
                  <span className={textRole('emphasis', 'text-secondary tabular-nums')}>
                    {formatPercent(numericMetric(signal, 'ctr'), 1)}
                  </span>
                ) : (
                  <UnavailableValue state="not_measured" />
                )}
              </div>
            </Stack>
          </Stack>
        )}

        {/* Where the figures came from, as counts and a date; internal IDs stay out of view. */}
        <Stack as="section" aria-labelledby="demand-provenance">
          <h3 id="demand-provenance" className={textRole('label', 'flex items-center gap-2')}>
            <ShieldCheck className="text-muted size-3.5" aria-hidden />
            Provenance
          </h3>
          <Stack as="dl" className={panelClasses({ tone: 'well' }, 'type-caption')}>
            <ProvenanceRow label="Search Console rows">
              <ProvenanceCount value={details.metricRowCount} />
            </ProvenanceRow>
            <ProvenanceRow label="Source imports">
              <ProvenanceCount value={details.artifactCount} />
            </ProvenanceRow>
            <ProvenanceRow label="Evaluated">
              <DisplayTime value={signal.created_at} dateOnly />
            </ProvenanceRow>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
}

function ProvenanceRow({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function demandEvidenceDetails(signal: DemandSignal) {
  const evidence = signal.evidence;
  const rawBand = evidence.position_band;
  return {
    targetKind: signalTargetKind(signal),
    target: signalTarget(signal),
    metrics: signal.metrics,
    pages: competingPages(signal),
    cohortMedianCtr: numericMetric(signal, 'cohort_median_ctr'),
    positionBand:
      typeof rawBand === 'number' && Number.isFinite(rawBand) ? Math.floor(rawBand) : null,
    linkablePageUrl: safePageUrl(signal.page_url),
    metricRowCount: sourceCount(evidence.source_metric_row_ids),
    artifactCount: sourceCount(evidence.source_artifact_ids),
  };
}

/** How many sources a provenance list names, or null when it was not recorded. */
function sourceCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function ProvenanceCount({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <UnavailableValue state="not_measured" /> : formatCount(value);
}
