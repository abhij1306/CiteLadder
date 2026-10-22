'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/drawer';
import { Dot } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ScoreBar } from '@/components/ui/score-bar';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { ReadinessCheck, ReadinessDimension } from '@/lib/api/types';
import { formatScore, PLACEHOLDER } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';

function pageLabel(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function formatCoverage(coverage: number | null): string {
  return coverage === null ? PLACEHOLDER : `${Math.round(coverage * 100)}%`;
}

type DimensionState =
  | 'Critical'
  | 'Needs work'
  | 'Nearly there'
  | 'Passing'
  | 'Not measured'
  | 'Not applicable'
  | 'Excluded';

/**
 * Say how the pillar SCORED, not whether any single check failed.
 *
 * The old rule flipped a pillar to red "Needs work" on one missing check
 * anywhere in the crawl, which put a 98-scoring Structure pillar in the same
 * state as a 0-scoring Evidence one and gave the reader nothing to prioritise
 * by. Bands come off the score the table already shows, so the badge and the
 * number can never contradict each other.
 */
function dimensionState(dimension: ReadinessDimension): DimensionState {
  if (dimension.dimension_applicability === 'not_applicable') return 'Not applicable';
  if (dimension.dimension_measurement_state === 'excluded') return 'Excluded';
  if (dimension.score === null) return 'Not measured';
  // Round prioritization bands for display. Passing below still requires an
  // actual perfect score over a complete measurement.
  const score = Math.round(dimension.score);
  if (score < 50) return 'Critical';
  if (score < 80) return 'Needs work';
  // A perfect score over an INCOMPLETE set is not a pass. Unresolved checks
  // cap the badge one band below, so "Passing" only ever means every
  // applicable check resolved and every one of them passed.
  const unresolved =
    dimension.dimension_measurement_state !== 'measured' ||
    dimension.unresolved_count > 0 ||
    dimension.unknown_count > 0 ||
    dimension.error_count > 0 ||
    dimension.partial_count > 0;
  if (dimension.score < 100 || unresolved) return 'Nearly there';
  return 'Passing';
}

function stateBadgeValue(state: DimensionState) {
  if (state === 'Critical') return 'danger' as const;
  if (state === 'Needs work') return 'warning' as const;
  if (state === 'Nearly there') return 'warning' as const;
  if (state === 'Passing') return 'success' as const;
  return 'info' as const;
}

export function AeoReadinessPanel({
  workspaceId,
  projectId,
  crawlId,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  crawlId: string;
}>) {
  const readiness = useQuery(siteHealthQueries.aeoReadiness(workspaceId, projectId, crawlId));
  const [detailKey, setDetailKey] = useState<string | null>(null);

  if (readiness.isLoading) {
    return <QueryState kind="loading" label="Loading persisted AEO evaluations…" />;
  }
  if (readiness.isError)
    return (
      <QueryState
        kind="error"
        error={readiness.error}
        fallback="Could not load AEO Readiness."
        onRetry={() => void readiness.refetch()}
        pending={readiness.isFetching}
      />
    );
  if (!readiness.data || readiness.data.crawl_id === null) {
    return (
      <Alert tone="info">
        {readiness.data?.limitations[0] ??
          'AEO Readiness appears once a crawl has finished analyzing pages.'}
      </Alert>
    );
  }

  const data = readiness.data;
  const selected = data.dimensions.find((dimension) => dimension.key === detailKey) ?? null;
  return (
    <Stack gap="workspace" className="min-w-0" data-testid="aeo-readiness">
      {data.limitations.length > 0 ? <Alert tone="info">{data.limitations.join(' ')}</Alert> : null}
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
    <DataTable title="Readiness dimensions" columns={READINESS_COLUMNS} minWidth="md">
      {dimensions.map((dimension) => {
        const state = dimensionState(dimension);
        return (
          <TableRow key={dimension.key}>
            <TableCell>
              <div className="grid min-w-0">
                <ClampText lines={1} className={textRole('emphasis')}>
                  {dimension.label}
                </ClampText>
                <ClampText lines={1} className="type-caption">
                  {dimension.description}
                </ClampText>
              </div>
            </TableCell>
            <TableCell numeric>{formatScore(dimension.score)}</TableCell>
            <TableCell>
              <QualityCell dimension={dimension} state={state} />
            </TableCell>
            <TableCell numeric>
              {dimension.coverage === null ? (
                <UnavailableValue state="not_measured" />
              ) : (
                formatCoverage(dimension.coverage)
              )}
            </TableCell>
            <TableCell>
              <Badge variant="status" value={stateBadgeValue(state)}>
                {state}
              </Badge>
            </TableCell>
            <TableCell>
              <Button variant="secondary" onClick={() => onOpen(dimension.key)}>
                View details <span className="sr-only">for {dimension.label}</span>
              </Button>
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

const READINESS_COLUMNS: readonly DataTableColumn[] = [
  { key: 'dimension', label: 'Dimension' },
  { key: 'score', label: 'Score', width: 'figure', numeric: true },
  { key: 'quality', label: 'Quality', width: 'status' },
  { key: 'coverage', label: 'Coverage', width: 'figure', numeric: true },
  { key: 'state', label: 'State', width: 'status' },
  { key: 'actions', label: 'Actions', width: 'date', hideLabel: true },
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
      description={dimension?.description ?? ''}
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
        <QueryState kind="empty" inline message="No determinate checks were recorded." />
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
        <span className={textRole('itemTitle')}>{check.title}</span>
        <span className="type-caption">{state}</span>
      </Inline>
      <p className={textRole('body')}>
        {check.remediation || 'No remediation guidance is recorded for this check.'}
      </p>
      <p className="type-caption tabular-nums">
        {check.satisfied_count} satisfied · {check.partial_count} partial · {check.missing_count}{' '}
        missing · {check.unknown_count} unknown
      </p>
    </Stack>
  );
}

function checkState(check: ReadinessCheck) {
  if (check.error_count > 0 || check.unknown_count > 0) return 'Incomplete';
  if (check.missing_count > 0 || check.partial_count > 0) return 'Needs work';
  if (check.satisfied_count > 0) return 'Passing';
  if (check.not_applicable_count > 0) return 'Did not apply';
  return 'Not measured';
}

/** Says whether the list is the whole set or only its worst rows. */
function failingPagesCaption(shown: number, total: number): string {
  if (total === 0) return 'No failing pages were recorded.';
  if (shown < total) return `Showing the ${shown} most affected of ${total} pages, worst first.`;
  const noun = total === 1 ? 'page' : 'pages';
  return `${total} ${noun} failed at least one check, worst first.`;
}

/**
 * The quality column: a bar when there is a score, and otherwise the reason.
 *
 * A dimension with no score is either one nothing measured or one the state
 * already explains, and those read differently — "not measured" is an absence
 * of evidence, the state is a finding.
 */
function QualityCell({
  dimension,
  state,
}: Readonly<{ dimension: ReadinessDimension; state: DimensionState }>) {
  if (dimension.score !== null) {
    return <ScoreBar value={dimension.score} label={`${dimension.label} score`} />;
  }
  if (dimension.dimension_measurement_state === 'not_measured') {
    return <UnavailableValue state="not_measured" />;
  }
  return <span className="type-caption">{state}</span>;
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
              text="itemTitle"
              className="truncate"
              href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
            >
              {pageLabel(page.normalized_url)}
            </TextLink>
            <Stack as="ul" gap="tight">
              {page.failed_checks.map((check) => (
                <Inline as="li" key={check.rule_id} className="type-caption items-baseline">
                  <Dot className="bg-danger" />
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

/** The next action for one failing page: the prompt for its failing checks. */
function PageActions({
  page,
  dimensionLabel,
}: Readonly<{
  page: ReadinessDimension['evidence_pages'][number];
  dimensionLabel: string;
}>) {
  // Every failing check gets the prompt a developer or assistant can act on.
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

/** The failing checks for one page, in a form a developer or agent can act on. */
function fixPrompt(
  dimensionLabel: string,
  url: string,
  checks: ReadinessDimension['evidence_pages'][number]['failed_checks'],
): string {
  const lines = checks.map((check) => `- ${check.title}: ${check.remediation}`);
  return [`Improve ${dimensionLabel} on ${url}.`, '', 'Failing checks:', ...lines].join('\n');
}
