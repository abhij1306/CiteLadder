'use client';

import {
  factTopicSchema,
  type AccuracyClaim,
  type AccuracyCoverage,
  type AccuracyResponse,
} from '@citeladder/contracts/fact-checking';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatGrid } from '@/components/ui/stat-grid';
import {
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
          <EmptyState
            variant="compact"
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
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
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
      <CardContent className="grid gap-2">
        <EmptyState
          variant="compact"
          icon={ShieldCheck}
          heading={copy.heading}
          description={copy.description}
        />
        {coverage?.claims ? <CoverageNote coverage={coverage} /> : null}
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
      <CardContent className="grid gap-2">
        <StatGrid
          surface="well"
          columns={4}
          label="Fact checks"
          items={[
            {
              key: 'accuracy',
              label: 'Accuracy',
              value: formatShare(data.score.accuracy),
              missingLabel: 'Unavailable',
              detail: 'Supported, of claims that were supported or contradicted.',
            },
            {
              key: 'supported',
              label: 'Supported',
              value: String(coverage.supported),
              tone: 'success',
              detail: 'A confirmed fact states the same thing.',
            },
            {
              key: 'contradicted',
              label: 'Contradicted',
              value: String(coverage.contradicted),
              tone: 'danger',
              detail: 'A confirmed fact states something incompatible.',
            },
            {
              key: 'not_covered',
              label: 'Not covered',
              value: String(coverage.not_covered + coverage.inconclusive),
              detail: `${coverage.not_covered} with no fact on the point, ${coverage.inconclusive} inconclusive.`,
            },
          ]}
        />
        <CoverageNote coverage={coverage} />
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
          <InlineEmpty>No contradicted claims in these answers.</InlineEmpty>
        ) : (
          <ul className="grid gap-3">
            {claims.map((claim) => (
              <li key={`${claim.execution_id}:${claim.quote}`} className="grid gap-1">
                <ClaimLink claim={claim} />
                {claim.facts.map((fact) => (
                  <span key={fact.statement} className="type-caption text-secondary">
                    Your fact: {fact.statement}
                  </span>
                ))}
                <span
                  className={textRole('caption', 'text-muted flex flex-wrap items-center gap-2')}
                >
                  <Badge variant="sentiment" value="negative">
                    {TOPIC_LABELS[claim.topic]}
                  </Badge>
                  {engineLabel(claim.logical_engine)} · {claim.prompt}
                </span>
              </li>
            ))}
          </ul>
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{column}</TableHead>
              <TableHead numeric>Claims</TableHead>
              <TableHead numeric>{VERDICT_LABELS.supported}</TableHead>
              <TableHead numeric>{VERDICT_LABELS.contradicted}</TableHead>
              <TableHead numeric>Accuracy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{label(row.key)}</TableCell>
                <TableCell numeric>{row.score.coverage.claims}</TableCell>
                <TableCell numeric>{row.score.coverage.supported}</TableCell>
                <TableCell numeric>{row.score.coverage.contradicted}</TableCell>
                <TableCell numeric>{formatShare(row.score.accuracy) ?? <MissingValue />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CitedTable({ cited }: Readonly<{ cited: AccuracyResponse['cited_alongside'] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources cited alongside contradictions</CardTitle>
        <CardDescription>
          Domains cited in answers with a contradicted claim. Cited alongside, not shown to be the
          source.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!cited.length ? (
          <InlineEmpty>No sources cited alongside contradictions.</InlineEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead numeric>Answers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cited.map((row) => (
                <TableRow key={row.domain}>
                  <TableCell>{row.domain}</TableCell>
                  <TableCell numeric>{row.answers}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
