import type {
  PerceptionCoverage,
  PerceptionQuote,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

import { BrandMark } from '@/components/ui/brand-mark';
import { StatusMark } from '@/components/ui/status-mark';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow, YouTag } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MessageSquareQuote } from '@/lib/icons';
import { useEngineCatalog } from '@/lib/providers/engines';
import { coverageLine, stateCopy } from '@/lib/visibility/perception';
import { SentimentValue } from '@/components/visibility/sentiment-value';
import { StateBlock } from '@/components/ui/state-block';
import { SectionContent, TitledSection } from '@/components/ui/section';

export function PerceptionState({
  state,
  reason,
  coverage,
}: Readonly<{
  state: Exclude<PerceptionResponse['state'], 'value'>;
  reason: PerceptionResponse['reason'];
  coverage?: PerceptionCoverage;
}>) {
  const copy = stateCopy(state, reason);
  const counted = coverage?.mentions ? coverageLine(coverage) : null;
  return (
    <StateBlock
      kind="empty"
      headingLevel={3}
      icon={MessageSquareQuote}
      heading={copy.heading}
      description={[copy.description, counted].filter(Boolean).join(' ') || undefined}
    />
  );
}

export function EntityTable({ entities }: Readonly<{ entities: PerceptionResponse['entities'] }>) {
  return (
    <TitledSection title="You and competitors">
      <DataTable label="You and competitors" columns={ENTITY_COLUMNS}>
        {entities.map((entity) => (
          <TableRow key={entity.name} highlight={entity.is_brand}>
            <TableCell>
              <Inline as="span">
                <BrandMark
                  name={entity.name}
                  logoUrl={entity.logo_url}
                  websiteUrl={entity.website_url}
                />
                <ClampText>{entity.name}</ClampText>
                {entity.is_brand ? <YouTag /> : null}
              </Inline>
            </TableCell>
            <TableCell numeric>
              {entity.score.classified} of {entity.coverage.mentions}
            </TableCell>
            <TableCell numeric>{entity.score.positive}</TableCell>
            <TableCell numeric>{entity.score.negative}</TableCell>
            <TableCell numeric>
              <SentimentValue
                sentiment={{ ...entity.score, mentions: entity.coverage.mentions }}
                tooFew="Too few"
                showCount={false}
              />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

const ENTITY_COLUMNS: readonly DataTableColumn[] = [
  { key: 'business', label: 'Business' },
  { key: 'classified', label: 'Classified', width: 'figure', kind: 'number', priority: 'low' },
  { key: 'positive', label: 'Positive', width: 'figure', kind: 'number' },
  { key: 'negative', label: 'Negative', width: 'figure', kind: 'number' },
  { key: 'net', label: 'Net sentiment', width: 'figure', kind: 'number', priority: 'low' },
];

export function QuoteLink({ quote }: Readonly<{ quote: PerceptionQuote }>) {
  return (
    <TextLink href={`/runs/${quote.run_id}?execution=${quote.execution_id}`}>
      “{quote.text}”
    </TextLink>
  );
}

export function NegativeQuotes({ quotes }: Readonly<{ quotes: PerceptionQuote[] }>) {
  const { label: engineLabel } = useEngineCatalog();
  return (
    <TitledSection title="Criticism in answers">
      <SectionContent>
        {!quotes.length ? (
          <StateBlock
            kind="empty"
            inline
            message="No negative points about you in these answers."
          />
        ) : (
          <Stack as="ul">
            {quotes.map((quote) => (
              <Stack as="li" gap="tight" key={`${quote.execution_id}:${quote.text}`}>
                <QuoteLink quote={quote} />
                <Inline as="span" className={textRole('caption', 'text-ink-2 flex-wrap')}>
                  <StatusMark variant="sentiment" value="negative">
                    {quote.theme}
                  </StatusMark>
                  {engineLabel(quote.logical_engine)} · {quote.prompt}
                </Inline>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionContent>
    </TitledSection>
  );
}
