'use client';

import {
  factTopicSchema,
  type AccuracyClaim,
  type AccuracyCoverage,
  type AccuracyResponse,
} from '@citeladder/contracts/fact-checking';
import { Globe, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/ui/stat-row';
import { TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  accuracyCoverageLine,
  accuracyStateCopy,
  TOPIC_LABELS,
  VERDICT_LABELS,
} from '@/lib/visibility/accuracy';
import { engineLabel } from '@/lib/visibility/dashboard';
import { formatShare } from '@/lib/visibility/perception';
import { useAccuracy } from '@/lib/visibility/use-accuracy';
import type { SourceQueries } from '@/lib/visibility/use-source-analysis';

/**
 * What answers claimed about the brand, checked against its confirmed facts.
 * Accuracy always travels with its coverage, and a claim without a verdict is
 * a named state, never a zero.
 */
export function VisibilityAccuracy({
  filters,
  queries,
}: Readonly<{ filters: SourceFilters; queries: SourceQueries }>) {
  const { query, enabled } = useAccuracy(filters, queries);
  if (query.error)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load fact checks. Check your connection and try again."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  // No run selected: nothing to read yet, which says nothing about the facts.
  if (!enabled)
    return (
      <Card>
        <CardContent>
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={ShieldCheck}
            heading="No run selected"
            description="Choose a run to see how its answers state your facts."
          />
        </CardContent>
      </Card>
    );
  if (!query.data)
    return (
      <Stack gap="workspace" aria-busy>
        <Skeleton shape="block" />
        <Skeleton shape="chart" />
      </Stack>
    );
  return (
    <div className="relative">
      <BusyBar active={query.isFetching} label="Updating fact checks" />
      <AccuracyView data={query.data} />
    </div>
  );
}

export function AccuracyView({ data }: Readonly<{ data: AccuracyResponse }>) {
  if (data.state !== 'value')
    return <AccuracyState state={data.state} reason={data.reason} coverage={data.score.coverage} />;
  return (
    <Stack gap="workspace">
      <Headline data={data} />
      <ContradictedClaims claims={data.contradicted} />
      <BreakdownTable title="By topic" column="Topic" rows={data.topics} label={topicLabel} />
      <BreakdownTable title="By engine" column="Engine" rows={data.engines} label={engineLabel} />
      <CitedTable cited={data.cited_alongside} />
    </Stack>
  );
}

function topicLabel(key: string) {
  const topic = factTopicSchema.safeParse(key);
  return topic.success ? TOPIC_LABELS[topic.data] : key;
}

function AccuracyState({
  state,
  reason,
  coverage,
}: Readonly<{
  state: Exclude<AccuracyResponse['state'], 'value'>;
  reason: AccuracyResponse['reason'];
  coverage?: AccuracyCoverage;
}>) {
  const copy = accuracyStateCopy(state, reason);
  return (
    <Card>
      <CardContent>
        <Stack gap="item">
          <QueryState
            kind="empty"
            headingLevel={3}
            icon={ShieldCheck}
            heading={copy.heading}
            description={copy.description}
          />
          {coverage?.claims ? <CoverageNote coverage={coverage} /> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function CoverageNote({ coverage }: Readonly<{ coverage: AccuracyCoverage }>) {
  return <p className={textRole('caption', 'text-muted')}>{accuracyCoverageLine(coverage)}</p>;
}

function Headline({ data }: Readonly<{ data: AccuracyResponse }>) {
  const { coverage } = data.score;
  return (
    <Card>
      <CardContent>
        <Stack gap="item">
          <StatRow
            label="Fact checks"
            segments={[
              {
                key: 'accuracy',
                label: 'Accuracy',
                value: formatShare(data.score.accuracy),
                missingLabel: 'Unavailable',
                sub: 'Supported, of claims that were supported or contradicted.',
              },
              {
                key: 'supported',
                label: 'Supported',
                value: String(coverage.supported),
                tone: 'success',
                sub: 'A confirmed fact states the same thing.',
              },
              {
                key: 'contradicted',
                label: 'Contradicted',
                value: String(coverage.contradicted),
                tone: 'danger',
                sub: 'A confirmed fact states something incompatible.',
              },
              {
                key: 'not_covered',
                label: 'Not covered',
                value: String(coverage.not_covered + coverage.inconclusive),
                sub: `${coverage.not_covered} with no fact on the point, ${coverage.inconclusive} inconclusive.`,
              },
            ]}
          />
          <CoverageNote coverage={coverage} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function ClaimLink({ claim }: Readonly<{ claim: AccuracyClaim }>) {
  return (
    <TextLink href={`/runs/${claim.run_id}?execution=${claim.execution_id}`}>
      “{claim.quote}”
    </TextLink>
  );
}

function ContradictedClaims({ claims }: Readonly<{ claims: AccuracyClaim[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contradicted claims</CardTitle>
        <CardDescription>
          What answers said about you that a confirmed fact contradicts, quoted exactly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!claims.length ? (
          <QueryState kind="empty" inline message="No contradicted claims in these answers." />
        ) : (
          <Stack as="ul">
            {claims.map((claim) => (
              <Stack as="li" gap="tight" key={`${claim.execution_id}:${claim.quote}`}>
                <ClaimLink claim={claim} />
                {claim.facts.map((fact) => (
                  <span key={fact.statement} className="type-caption text-secondary">
                    Your fact: {fact.statement}
                  </span>
                ))}
                <Inline as="span" className={textRole('caption', 'text-muted flex-wrap')}>
                  <Badge variant="sentiment" value="negative">
                    {TOPIC_LABELS[claim.topic]}
                  </Badge>
                  {engineLabel(claim.logical_engine)} · {claim.prompt}
                </Inline>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({
  title,
  column,
  rows,
  label,
}: Readonly<{
  title: string;
  column: string;
  rows: AccuracyResponse['topics'];
  label: (key: string) => string;
}>) {
  if (!rows.length) return null;
  return (
    <DataTable
      title={title}
      columns={[
        { key: 'key', label: column },
        { key: 'claims', label: 'Claims', width: 'figure', numeric: true },
        { key: 'supported', label: VERDICT_LABELS.supported, width: 'figure', numeric: true },
        { key: 'contradicted', label: VERDICT_LABELS.contradicted, width: 'figure', numeric: true },
        { key: 'accuracy', label: 'Accuracy', width: 'figure', numeric: true },
      ]}
    >
      {rows.map((row) => (
        <TableRow key={row.key}>
          <TableCell>{label(row.key)}</TableCell>
          <TableCell numeric>{row.score.coverage.claims}</TableCell>
          <TableCell numeric>{row.score.coverage.supported}</TableCell>
          <TableCell numeric>{row.score.coverage.contradicted}</TableCell>
          <TableCell numeric>{formatShare(row.score.accuracy) ?? <MissingValue />}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function CitedTable({ cited }: Readonly<{ cited: AccuracyResponse['cited_alongside'] }>) {
  return (
    <DataTable
      title="Sources cited alongside contradictions"
      columns={[
        { key: 'domain', label: 'Domain' },
        { key: 'answers', label: 'Answers', width: 'figure', numeric: true },
      ]}
      footer="Domains cited in answers with a contradicted claim. Cited alongside, not shown to be the source."
      state={
        cited.length
          ? undefined
          : {
              kind: 'empty',
              headingLevel: 3,
              icon: Globe,
              heading: 'No sources cited alongside contradictions',
            }
      }
    >
      {cited.map((row) => (
        <TableRow key={row.domain}>
          <TableCell>{row.domain}</TableCell>
          <TableCell numeric>{row.answers}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}
