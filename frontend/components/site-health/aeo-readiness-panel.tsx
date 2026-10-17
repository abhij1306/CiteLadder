'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PageLoading } from '@/components/layout/page-loading';
import { Alert } from '@/components/ui/alert';
import { ReadError } from '@/components/ui/read-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Drawer } from '@/components/ui/drawer';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ScoreBar } from '@/components/ui/score-bar';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRecordMetricCell,
  TableRow,
} from '@/components/ui/table';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { ReadinessCheck, ReadinessDimension } from '@/lib/api/types';
import { formatScore, PLACEHOLDER } from '@/lib/site-health/status';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader, ledgerClasses } from '@/components/ui/workspace';

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
    return <PageLoading label="Loading persisted AEO evaluations…" />;
  }
  if (readiness.isError)
    return (
      <ReadError
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
    <div className="grid min-w-0 gap-4" data-testid="aeo-readiness">
      {data.limitations.length > 0 ? <Alert tone="info">{data.limitations.join(' ')}</Alert> : null}
      <ReadinessLedger dimensions={data.dimensions} onOpen={setDetailKey} />
      <DimensionDrawer dimension={selected} crawlId={crawlId} onClose={() => setDetailKey(null)} />
    </div>
  );
}

function ReadinessLedger({
  dimensions,
  onOpen,
}: Readonly<{ dimensions: ReadinessDimension[]; onOpen: (key: string) => void }>) {
  return (
    <Card>
      <CardHeader bordered>
        <CardTitle>Readiness dimensions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table className="block md:table" wrapperClassName="overflow-hidden md:overflow-auto">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead>Dimension</TableHead>
              <TableHead numeric>Score</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead numeric>Coverage</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {dimensions.map((dimension) => {
              const state = dimensionState(dimension);
              return (
                <TableRow
                  key={dimension.key}
                  className="grid h-auto grid-cols-1 py-2 md:table-row md:h-[var(--table-row-height)] md:py-0"
                >
                  <TableCell className="block min-w-0 border-b-0 px-4 py-2 md:table-cell md:min-w-64 md:border-b md:px-[var(--table-cell-padding-x)] md:py-[var(--table-cell-padding-y)]">
                    <div className="grid max-w-md min-w-0">
                      <ClampText lines={1} className={textRole('emphasis')}>
                        {dimension.label}
                      </ClampText>
                      <ClampText lines={1} className="type-caption">
                        {dimension.description}
                      </ClampText>
                    </div>
                  </TableCell>
                  <TableRecordMetricCell label="Score">
                    {formatScore(dimension.score)}
                  </TableRecordMetricCell>
                  <TableRecordMetricCell label="Quality" className="md:min-w-32">
                    <QualityCell dimension={dimension} state={state} />
                  </TableRecordMetricCell>
                  <TableRecordMetricCell label="Coverage">
                    {dimension.coverage === null ? (
                      <UnavailableValue state="not_measured" />
                    ) : (
                      formatCoverage(dimension.coverage)
                    )}
                  </TableRecordMetricCell>
                  <TableRecordMetricCell label="State" className="items-center">
                    <Badge variant="status" value={stateBadgeValue(state)}>
                      {state}
                    </Badge>
                  </TableRecordMetricCell>
                  <TableCell className="block px-4 pt-2 pb-3 md:table-cell md:px-[var(--table-cell-padding-x)] md:py-[var(--table-cell-padding-y)]">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full md:w-auto"
                      onClick={() => onOpen(dimension.key)}
                    >
                      View details <span className="sr-only">for {dimension.label}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

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
        <div className="grid gap-[var(--workspace-gap)]">
          <CheckLedger checks={dimension.checks} />
          <FailingPages dimension={dimension} crawlId={crawlId} />
        </div>
      ) : null}
    </Drawer>
  );
}

function CheckLedger({ checks }: Readonly<{ checks: ReadinessCheck[] }>) {
  return (
    <section className="grid gap-2">
      <EditorialSectionHeader title="Checks" />
      {checks.length === 0 ? (
        <InlineEmpty>No determinate checks were recorded.</InlineEmpty>
      ) : (
        <ul className={ledgerClasses()}>
          {checks.map((check) => (
            <CheckRow key={check.rule_id} check={check} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CheckRow({ check }: Readonly<{ check: ReadinessCheck }>) {
  const state = checkState(check);
  return (
    <li className="grid gap-1 py-3 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={textRole('itemTitle')}>{check.title}</span>
        <span className="type-caption">{state}</span>
      </div>
      <p className={textRole('body')}>
        {check.remediation || 'No remediation guidance is recorded for this check.'}
      </p>
      <p className="type-caption tabular-nums">
        {check.satisfied_count} satisfied · {check.partial_count} partial · {check.missing_count}{' '}
        missing · {check.unknown_count} unknown
      </p>
    </li>
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
    <section className="grid gap-2">
      <EditorialSectionHeader
        title="Pages to fix"
        description={failingPagesCaption(shown, total)}
      />
      <ul className={ledgerClasses()}>
        {dimension.evidence_pages.map((page) => (
          <li key={page.site_url_id} className="grid gap-2 py-3 first:pt-0">
            <TextLink
              text="itemTitle"
              className="truncate"
              href={`/site/crawls/${crawlId}/pages/${page.site_url_id}`}
            >
              {pageLabel(page.normalized_url)}
            </TextLink>
            <ul className="grid gap-1">
              {page.failed_checks.map((check) => (
                <li key={check.rule_id} className="type-caption flex items-start gap-2">
                  <span className="bg-danger mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                  <span>
                    {check.title}: {check.expected_capability}
                  </span>
                </li>
              ))}
            </ul>
            <PageActions page={page} dimensionLabel={dimension.label} />
          </li>
        ))}
      </ul>
    </section>
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
    <div className="flex flex-wrap items-center gap-3">
      {promptChecks.length > 0 ? (
        <CopyButton
          value={fixPrompt(dimensionLabel, page.normalized_url, promptChecks)}
          size="sm"
          variant="secondary"
        >
          Copy fix prompt
        </CopyButton>
      ) : null}
    </div>
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
