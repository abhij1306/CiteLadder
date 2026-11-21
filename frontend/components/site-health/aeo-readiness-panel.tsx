import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { StatusMark, type StatusTone } from '@/components/ui/status-mark';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/drawer';
import { Dot } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type { ReadinessCheck, ReadinessDimension } from '@citeladder/contracts';
import { scoreBand } from '@/lib/score-band';
import { formatScore } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { type DataAvailabilityState, formatCount, formatPercent, pluralCount } from '@/lib/format';

function pageLabel(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

type DimensionBand = 'Critical' | 'Needs work' | 'Nearly there' | 'Passing' | 'Excluded';

type DimensionState =
  | DimensionBand
  | Extract<DataAvailabilityState, 'not_applicable' | 'not_measured'>;

function dimensionState(dimension: ReadinessDimension): DimensionState {
  if (dimension.dimension_applicability === 'not_applicable') return 'not_applicable';
  if (dimension.dimension_measurement_state === 'excluded') return 'Excluded';
  if (dimension.score === null) return 'not_measured';
  const band = scoreBand(Math.round(dimension.score));
  if (band === 'low') return 'Critical';
  if (band === 'mid') return 'Needs work';
  const unresolved =
    dimension.dimension_measurement_state !== 'measured' ||
    dimension.unresolved_count > 0 ||
    dimension.unknown_count > 0 ||
    dimension.error_count > 0 ||
    dimension.partial_count > 0;
  if (dimension.score < 100 || unresolved) return 'Nearly there';
  return 'Passing';
}

function bandReason(dimension: ReadinessDimension): string | null {
  if (dimension.score === null || Math.round(dimension.score) < 100) return null;
  if (dimensionState(dimension) !== 'Nearly there') return null;
  if (dimension.unresolved_count > 0) {
    return `${pluralCount(dimension.unresolved_count, 'check')} unresolved`;
  }
  const incomplete = dimension.checks.filter(
    (check) => check.error_count > 0 || check.unknown_count > 0,
  ).length;
  if (incomplete > 0) return `${pluralCount(incomplete, 'check')} incomplete`;
  const partial = dimension.checks.filter(
    (check) => check.partial_count > 0 || check.missing_count > 0,
  ).length;
  if (partial > 0) return `${pluralCount(partial, 'check')} not fully met`;
  if (dimension.dimension_measurement_state === 'limited_evidence') return 'Limited evidence';
  return 'Not every check resolved';
}

const DIMENSION_TONES: Record<DimensionBand, StatusTone> = {
  Critical: 'negative',
  'Needs work': 'warning',
  'Nearly there': 'info',
  Passing: 'positive',
  Excluded: 'neutral',
};

type CheckState = 'Incomplete' | 'Needs work' | 'Passing' | 'Did not apply' | 'Not checked';

const CHECK_TONES: Record<CheckState, StatusTone> = {
  Incomplete: 'info',
  'Needs work': 'warning',
  Passing: 'positive',
  'Did not apply': 'neutral',
  'Not checked': 'neutral',
};

export function AeoReadinessPanel({
  workspaceId,
  projectId,
  crawlId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  crawlId: string;
}>) {
  const readiness = useQuery(siteHealthQueries.aeoReadiness({ workspaceId, projectId }, crawlId));
  const [detailKey, setDetailKey] = useState<string | null>(null);

  if (readiness.isLoading) {
    return (
      <StateBlock
        kind="loading"
        label="Loading AEO readiness"
        shape={{ kind: 'table', columns: 4 }}
      />
    );
  }
  if (readiness.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(readiness)}
        fallback="Retry in a moment."
        title="Couldn't load AEO readiness"
      />
    );
  if (!readiness.data || readiness.data.crawl_id === null) {
    return (
      <Notice tone="info">{readiness.data?.limitations[0] ?? 'No analyzed crawl yet.'}</Notice>
    );
  }

  const data = readiness.data;
  const selected = data.dimensions.find((dimension) => dimension.key === detailKey) ?? null;
  return (
    <Stack gap="workspace" className="min-w-0" data-testid="aeo-readiness">
      {data.limitations.length > 0 ? (
        <Notice tone="info">{data.limitations.join(' ')}</Notice>
      ) : null}
      <ReadinessLedger dimensions={data.dimensions} onOpen={setDetailKey} />
      <DimensionDrawer dimension={selected} crawlId={crawlId} onClose={() => setDetailKey(null)} />
    </Stack>
  );
}

function ReadinessLedger({
  dimensions,
  onOpen,
}: Readonly<{ dimensions: ReadinessDimension[]; onOpen: (key: string) => void }>) {
  return (
    <DataTable title="Readiness dimensions" columns={READINESS_COLUMNS}>
      {dimensions.map((dimension) => {
        const state = dimensionState(dimension);
        const reason = bandReason(dimension);
        const open = () => onOpen(dimension.key);
        return (
          <TableRow key={dimension.key} onClick={open} className="cursor-pointer">
            <TableCell>
              <Pressable
                aria-haspopup="dialog"
                aria-label={`${dimension.label} evidence`}
                onClick={(event) => {
                  event.stopPropagation();
                  open();
                }}
                className="grid min-w-0"
              >
                <ClampText lines={1} className={textRole('emphasis')}>
                  {dimension.label}
                </ClampText>
              </Pressable>
            </TableCell>
            <TableCell numeric>{formatScore(dimension.score)}</TableCell>
            <TableCell numeric>
              {dimension.coverage === null ? (
                <Absence state="not_measured" />
              ) : (
                formatPercent(dimension.coverage)
              )}
            </TableCell>
            <TableCell>
              <Inline>
                {state === 'not_applicable' || state === 'not_measured' ? (
                  <Absence state={state} />
                ) : (
                  <StatusMark tone={DIMENSION_TONES[state]}>{state}</StatusMark>
                )}
                {reason ? <ClampText className="type-caption">{reason}</ClampText> : null}
              </Inline>
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

const READINESS_COLUMNS: readonly DataTableColumn[] = [
  { key: 'dimension', label: 'Dimension', kind: 'identity' },
  { key: 'score', label: 'Score', kind: 'number' },
  { key: 'coverage', label: 'Coverage', kind: 'number' },
  { key: 'state', label: 'State', kind: 'status', width: 'flex' },
];

function DimensionDrawer({
  dimension,
  crawlId,
  onClose,
}: Readonly<{
  dimension: ReadinessDimension | null;
  crawlId: string;
  onClose: () => void;
}>) {
  return (
    <Drawer
      open={Boolean(dimension)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={dimension ? `${dimension.label} evidence` : ''}
      closeLabel="Close evidence"
    >
      {dimension ? (
        <Stack gap="workspace">
          <CheckLedger checks={dimension.checks} />
          <FailingPages dimension={dimension} crawlId={crawlId} />
        </Stack>
      ) : null}
    </Drawer>
  );
}

function CheckLedger({ checks }: Readonly<{ checks: ReadinessCheck[] }>) {
  return (
    <Stack as="section" gap="item">
      <EditorialSectionHeader title="Checks" />
      {checks.length === 0 ? (
        <StateBlock kind="empty" inline message="No determinate checks were recorded." />
      ) : (
        <ul className={ledgerClasses()}>
          {checks.map((check) => (
            <CheckRow key={check.rule_id} check={check} />
          ))}
        </ul>
      )}
    </Stack>
  );
}

function CheckRow({ check }: Readonly<{ check: ReadinessCheck }>) {
  const state = checkState(check);
  return (
    <Stack as="li" gap="tight" className={ledgerItemClasses()}>
      <Inline className="flex-wrap justify-between">
        <span className={textRole('body')}>{check.title}</span>
        <StatusMark tone={CHECK_TONES[state]}>{state}</StatusMark>
      </Inline>
      <p className={textRole('body', check.remediation ? 'text-ink' : 'text-ink-2')}>
        {check.remediation || '—'}
      </p>
      <p className="type-caption tabular-nums">
        {check.satisfied_count} satisfied · {check.partial_count} partial · {check.missing_count}{' '}
        missing · {check.unknown_count} unknown
      </p>
    </Stack>
  );
}

function checkState(check: ReadinessCheck): CheckState {
  if (check.error_count > 0 || check.unknown_count > 0) return 'Incomplete';
  if (check.missing_count > 0 || check.partial_count > 0) return 'Needs work';
  if (check.satisfied_count > 0) return 'Passing';
  if (check.not_applicable_count > 0) return 'Did not apply';
  return 'Not checked';
}

function failingPagesCaption(shown: number, total: number): string | undefined {
  if (total === 0) return '—';
  return shown < total ? `Worst ${formatCount(shown)} of ${formatCount(total)}` : undefined;
}

function FailingPages({
  dimension,
  crawlId,
}: Readonly<{ dimension: ReadinessDimension; crawlId: string }>) {
  const shown = dimension.evidence_pages.length;
  const total = dimension.failing_page_count;
  return (
    <Stack as="section" gap="item">
      <EditorialSectionHeader
        title="Pages to fix"
        description={failingPagesCaption(shown, total)}
      />
      <ul className={ledgerClasses()}>
        {dimension.evidence_pages.map((page) => (
          <Stack as="li" gap="item" key={page.site_url_id} className={ledgerItemClasses()}>
            <TextLink
              text="body"
              className="truncate"
              href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
            >
              {pageLabel(page.normalized_url)}
            </TextLink>
            <Stack as="ul" gap="tight">
              {page.failed_checks.map((check) => (
                <Inline as="li" key={check.rule_id} className="type-caption items-baseline">
                  <Dot className="bg-negative" />
                  <span>
                    {check.title}: {check.expected_capability}
                  </span>
                </Inline>
              ))}
            </Stack>
            <PageActions page={page} dimensionLabel={dimension.label} />
          </Stack>
        ))}
      </ul>
    </Stack>
  );
}

function PageActions({
  page,
  dimensionLabel,
}: Readonly<{
  page: ReadinessDimension['evidence_pages'][number];
  dimensionLabel: string;
}>) {
  const promptChecks = page.failed_checks;
  return (
    <Inline gap="compact" className="flex-wrap">
      {promptChecks.length > 0 ? (
        <CopyButton
          value={fixPrompt(dimensionLabel, page.normalized_url, promptChecks)}
          variant="secondary"
        >
          Copy fix prompt
        </CopyButton>
      ) : null}
    </Inline>
  );
}

function fixPrompt(
  dimensionLabel: string,
  url: string,
  checks: ReadinessDimension['evidence_pages'][number]['failed_checks'],
): string {
  const lines = checks.map((check) => `- ${check.title}: ${check.remediation}`);
  return [`Improve ${dimensionLabel} on ${url}.`, '', 'Failing checks:', ...lines].join('\n');
}
