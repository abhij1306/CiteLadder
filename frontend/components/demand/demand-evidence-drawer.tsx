import type { ReactNode } from 'react';
import { ProjectLink } from '@/components/ui/project-link';

import { SignalInsight } from '@/components/demand/demand-signal-insight';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Absence } from '@/components/ui/absence';
import type { DemandDetectorPolicy } from '@citeladder/contracts';
import { ArrowUpRight, ShieldCheck, Split } from '@/lib/icons';
import type { DemandSignal } from '@/lib/api/demand';
import {
  competingPages,
  demandSignalHandoffHref,
  numericMetric,
  signalTarget,
} from '@/lib/demand/signals';
import { DisplayTime } from '@/components/ui/display-time';
import { formatCount, formatPercent } from '@/lib/format';
import { textRole } from '@/components/ui/typography';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { wellClasses } from '@/components/ui/slip';

export function DemandEvidenceDrawer({
  signal,
  policy,
  open,
  onOpenChange,
}: Readonly<{
  signal: DemandSignal | null;
  policy: DemandDetectorPolicy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  if (!signal) return null;
  const details = demandEvidenceDetails(signal);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Signal evidence"
      title={details.target}
      footer={
        <Inline className="flex-wrap justify-between">
          {signal.action_id ? (
            <ActionButton
              action="openAction"
              href={`/actions/${signal.action_id}`}
              aria-label={`Open the Action for ${details.target}`}
            />
          ) : null}
          <Button variant="secondary" asChild>
            <ProjectLink
              href={demandSignalHandoffHref(signal)}
              className="inline-flex items-center"
            >
              <Icon icon={ArrowUpRight} />
              Ask agent
            </ProjectLink>
          </Button>
        </Inline>
      }
    >
      <Stack gap="workspace">
        <SignalInsight signal={signal} policy={policy} />

        {details.pages.length > 0 && (
          <Stack as="section">
            <Inline as="h3" className={textRole('body', 'text-ink-2')}>
              <Icon icon={Split} className="text-ink-2" />
              Competing pages ({details.pages.length})
            </Inline>
            <div className={ledgerClasses()}>
              {details.pages.map((page) => (
                <Stack key={page.url} gap="tight" className={ledgerItemClasses('type-caption')}>
                  <div className={textRole('emphasis', 'text-ink truncate')} title={page.url}>
                    {page.url}
                  </div>
                  <div className="type-caption flex items-center justify-between">
                    <span>{formatCount(page.impressions)} impressions</span>
                    <span className={textRole('emphasis', 'text-ink tabular-nums')}>
                      {formatPercent(page.share)} query share
                    </span>
                  </div>
                </Stack>
              ))}
            </div>
          </Stack>
        )}

        {details.cohortMedianCtr !== null && (
          <Stack as="section">
            <h3 className={textRole('body', 'text-ink-2')}>Position benchmark</h3>
            <Stack className={wellClasses('type-caption')}>
              <div className="flex justify-between">
                <span className="text-ink-2">Position band</span>
                {details.positionBand !== null ? (
                  <span className={textRole('emphasis', 'text-ink')}>
                    Positions {details.positionBand}.0 – {details.positionBand}.9
                  </span>
                ) : (
                  <Absence state="not_measured" />
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-ink-2">Median CTR in this band</span>
                <span className={textRole('emphasis', 'text-ink-2 tabular-nums')}>
                  {formatPercent(details.cohortMedianCtr)}
                </span>
              </div>
            </Stack>
          </Stack>
        )}

        <Stack as="section" aria-labelledby="demand-provenance">
          <Inline as="h3" id="demand-provenance" className={textRole('body', 'text-ink-2')}>
            <Icon icon={ShieldCheck} className="text-ink-2" />
            Provenance
          </Inline>
          <Stack as="dl" className={wellClasses('type-caption')}>
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
    <Inline gap="workspace" className="justify-between">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-ink tabular-nums">{children}</dd>
    </Inline>
  );
}

function demandEvidenceDetails(signal: DemandSignal) {
  const evidence = signal.evidence;
  const rawBand = evidence.position_band;
  return {
    target: signalTarget(signal),
    pages: competingPages(signal),
    cohortMedianCtr: numericMetric(signal, 'cohort_median_ctr'),
    positionBand:
      typeof rawBand === 'number' && Number.isFinite(rawBand) ? Math.floor(rawBand) : null,
    metricRowCount: sourceCount(evidence.source_metric_row_ids),
    artifactCount: sourceCount(evidence.source_artifact_ids),
  };
}

function sourceCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function ProvenanceCount({ value }: Readonly<{ value: number | null }>) {
  return value === null ? <Absence state="not_measured" /> : formatCount(value);
}
