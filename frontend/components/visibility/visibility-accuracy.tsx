import {
  factTopicSchema,
  type AccuracyClaim,
  type AccuracyCoverage,
  type AccuracyResponse,
} from '@citeladder/contracts/fact-checking';
import type { ReactNode } from 'react';

import { Delta } from '@/components/ui/delta';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusMark } from '@/components/ui/status-mark';
import { DataTable } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ShieldCheck } from '@/lib/icons';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import {
  accuracyCoverageExtras,
  accuracyCoverageLine,
  accuracyStateCopy,
  contradictedChange,
  TOPIC_LABELS,
  VERDICT_LABELS,
  VERDICT_TONE,
} from '@/lib/visibility/accuracy';
import { useEngineCatalog } from '@/lib/providers/engines';
import { formatPercent, percentText } from '@/lib/format';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, TitledSection, SectionStack } from '@/components/ui/section';
import { FigureStrip } from '@/components/ui/figure-strip';

type ClaimView = 'contradicted' | 'all-claims' | 'by-fact';

const CLAIM_VIEWS = [
  { value: 'contradicted', label: 'Contradicted' },
  { value: 'all-claims', label: 'All claims' },
  { value: 'by-fact', label: 'By fact' },
] as const satisfies readonly { value: ClaimView; label: string }[];

const CLAIM_VIEW_CODEC = stringUrlCodec<ClaimView>(
  CLAIM_VIEWS.map((item) => item.value),
  'contradicted',
);

export function AccuracyView({
  data,
  lede,
  stateActions,
  trend,
  allClaims,
  byFact,
}: Readonly<{
  data: AccuracyResponse;
  lede?: ReactNode;
  stateActions?: ReactNode;
  trend?: ReactNode;
  allClaims: ReactNode;
  byFact: ReactNode;
}>) {
  const { label: engineLabel } = useEngineCatalog();
  const [view, setView] = useUrlState('claims', CLAIM_VIEW_CODEC, { history: 'replace' });
  if (data.state !== 'value') {
    const state = (
      <AccuracyState state={data.state} reason={data.reason} coverage={data.score.coverage} />
    );
    const actionable = data.state === 'no_facts' || data.state === 'no_claims';
    return actionable && stateActions ? (
      <Stack gap="item">
        <Inline className="justify-end">{stateActions}</Inline>
        {state}
      </Stack>
    ) : (
      state
    );
  }
  return (
    <SectionStack>
      <Headline data={data} lede={lede} />
      {trend}
      <Section aria-label="Claims">
        <Tabs value={view} onValueChange={setView} items={CLAIM_VIEWS} ariaLabel="Claims" spaced>
          <TabPanel value="contradicted">
            <ContradictedClaims claims={data.contradicted} />
          </TabPanel>
          <TabPanel value="all-claims">{allClaims}</TabPanel>
          <TabPanel value="by-fact">{byFact}</TabPanel>
        </Tabs>
      </Section>
      <CitedTable cited={data.cited_alongside} />
      <BreakdownTable title="By topic" column="Topic" rows={data.topics} label={topicLabel} />
      <BreakdownTable title="By engine" column="Engine" rows={data.engines} label={engineLabel} />
    </SectionStack>
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
  const counted = coverage?.claims ? accuracyCoverageLine(coverage) : null;
  return (
    <StateBlock
      kind="empty"
      headingLevel={3}
      icon={ShieldCheck}
      heading={copy.heading}
      description={[copy.description, counted].filter(Boolean).join(' ') || undefined}
    />
  );
}

function CoverageNote({ coverage }: Readonly<{ coverage: AccuracyCoverage }>) {
  const extras = accuracyCoverageExtras(coverage);
  if (!extras.length) return null;
  return <p className={textRole('caption', 'text-ink-2')}>{extras.join(' · ')}</p>;
}

function Headline({ data, lede }: Readonly<{ data: AccuracyResponse; lede?: ReactNode }>) {
  const { coverage } = data.score;
  return (
    <Section>
      <SectionContent>
        <Stack gap="item">
          {lede}
          <FigureStrip
            label="Fact checks"
            subLine
            segments={[
              {
                key: 'claims',
                label: 'Claims',
                value: String(coverage.claims),
              },
              {
                key: 'contradicted',
                label: 'Contradicted',
                value: String(coverage.contradicted),
                delta: (
                  <Delta
                    value={contradictedChange(data)}
                    policy="lower-is-better"
                    precision={0}
                    context="vs previous"
                  />
                ),
              },
              { key: 'supported', label: 'Supported', value: String(coverage.supported) },
              {
                key: 'accuracy',
                label: 'Accuracy',
                value: data.score.accuracy === null ? null : percentText(data.score.accuracy),
                missingState: 'unavailable',
                sub: (
                  <Tooltip content="Verdicts a person changed">
                    <span>{coverage.edited} edited</span>
                  </Tooltip>
                ),
              },
              {
                key: 'not_checked',
                label: 'Not checked',
                value: String(coverage.inconclusive + coverage.not_covered),
                sub: `${coverage.inconclusive} ${VERDICT_LABELS.inconclusive.toLowerCase()} · ${coverage.not_covered} ${VERDICT_LABELS.not_covered.toLowerCase()}`,
              },
            ]}
          />
          <CoverageNote coverage={coverage} />
        </Stack>
      </SectionContent>
    </Section>
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
  const { label: engineLabel } = useEngineCatalog();
  return (
    <Stack gap="item">
      {!claims.length ? (
        <StateBlock kind="empty" inline message="No contradicted claims in these answers." />
      ) : (
        <Stack as="ul">
          {claims.map((claim) => (
            <Stack as="li" gap="tight" key={`${claim.execution_id}:${claim.quote}`}>
              <ClaimLink claim={claim} />
              {claim.facts.map((fact) => (
                <span key={fact.statement} className="type-caption text-ink-2">
                  Your fact: {fact.statement}
                </span>
              ))}
              <Inline as="span" className={textRole('caption', 'text-ink-2 flex-wrap')}>
                <StatusMark
                  variant="sentiment"
                  value={claim.verdict ? VERDICT_TONE[claim.verdict] : 'neutral'}
                >
                  {TOPIC_LABELS[claim.topic]}
                </StatusMark>
                {engineLabel(claim.logical_engine)} · {claim.prompt}
              </Inline>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
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
    <TitledSection title={title}>
      <DataTable
        label={title}
        columns={[
          { key: 'key', label: column },
          { key: 'claims', label: 'Claims', width: 'figure', kind: 'number' },
          { key: 'supported', label: VERDICT_LABELS.supported, width: 'figure', kind: 'number' },
          {
            key: 'contradicted',
            label: VERDICT_LABELS.contradicted,
            width: 'figure',
            kind: 'number',
          },
          { key: 'accuracy', label: 'Accuracy', width: 'figure', kind: 'number' },
        ]}
      >
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{label(row.key)}</TableCell>
            <TableCell numeric>{row.score.coverage.claims}</TableCell>
            <TableCell numeric>{row.score.coverage.supported}</TableCell>
            <TableCell numeric>{row.score.coverage.contradicted}</TableCell>
            <TableCell numeric>{formatPercent(row.score.accuracy)}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

function CitedTable({ cited }: Readonly<{ cited: AccuracyResponse['cited_alongside'] }>) {
  return (
    <TitledSection title="Sources cited alongside contradictions">
      <DataTable
        label="Sources cited alongside contradictions"
        columns={[
          { key: 'domain', label: 'Domain' },
          { key: 'answers', label: 'Answers', width: 'figure', kind: 'number' },
        ]}
        state={
          cited.length
            ? undefined
            : { kind: 'empty', inline: true, message: 'No sources cited alongside contradictions.' }
        }
      >
        {cited.map((row) => (
          <TableRow key={row.domain}>
            <TableCell>
              <ClampText>{row.domain}</ClampText>
            </TableCell>
            <TableCell numeric>{row.answers}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}
