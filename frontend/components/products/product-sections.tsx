import { useState, type ReactNode } from 'react';

import { ExecutionEvidenceDrawer } from '@/components/runs/execution-evidence-drawer';
import { Badge, type StatusValue } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { Measured } from '@/components/products/measured';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { formatCount, pluralCount } from '@/lib/format';
import { formatPosition, formatRate, holderCaption } from '@/lib/products/product-columns';
import { productHref, type ProductScopeFilters } from '@/lib/products/product-filters';
import { useEngineCatalog } from '@/lib/providers/engines';

type Answer = CommerceProductDetail['answers'][number];

const OUTCOMES: Record<Answer['outcome'], { label: string; tone: StatusValue }> = {
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
  unranked: { label: 'Unranked', tone: 'info' },
};

/** One titled card holding a ledger, or a sentence when the ledger is empty. */
function Section({
  title,
  description,
  empty,
  children,
}: Readonly<{ title: string; description: string; empty: string | null; children: ReactNode }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty === null ? (
          <ul className={ledgerClasses()}>{children}</ul>
        ) : (
          <p className={textRole('body')}>{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  primary,
  secondary,
  end,
}: Readonly<{ primary: ReactNode; secondary?: ReactNode; end?: ReactNode }>) {
  return (
    <Inline as="li" gap="compact" className={ledgerItemClasses('flex-wrap')}>
      <Stack gap="tight" className="min-w-0 flex-1">
        <span className={textRole('emphasis', 'truncate')}>{primary}</span>
        {secondary ? <span className="type-caption">{secondary}</span> : null}
      </Stack>
      {end}
    </Inline>
  );
}

export function CompetingProducts({
  detail,
  scope,
}: Readonly<{ detail: CommerceProductDetail; scope: ProductScopeFilters }>) {
  const rows = detail.competing;
  return (
    <Section
      title="Competing products"
      description="Products named in the same answers, by answers shared."
      empty={rows.length ? null : 'No other product was named in its answers.'}
    >
      {rows.map((row) => (
        <Row
          key={row.holder_id}
          primary={
            <TextLink href={productHref(row.holder_id, scope)} text="inherit">
              {row.name}
            </TextLink>
          }
          secondary={[
            holderCaption(row),
            `In ${pluralCount(row.shared, 'shared answer')}`,
            `ranked above it in ${formatCount(row.ahead)}`,
          ].join(' · ')}
          end={
            <span className="type-caption tabular-nums">
              Position <Measured value={row.position} format={formatPosition} />
            </span>
          }
        />
      ))}
    </Section>
  );
}

export function Merchants({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <Section
      title="Merchants"
      description="Where the answers send shoppers to buy it."
      empty={detail.merchants.length ? null : 'No answer named a merchant for it.'}
    >
      {detail.merchants.map((row) => (
        <Row
          key={row.domain}
          primary={row.domain}
          end={
            <span className="type-caption tabular-nums">{pluralCount(row.count, 'answer')}</span>
          }
        />
      ))}
    </Section>
  );
}

export function Sources({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <Section
      title="Sources"
      description="Pages cited by the answers that named it."
      empty={detail.sources.length ? null : 'The answers that named it cited no pages.'}
    >
      {detail.sources.map((row) => (
        <Row
          key={row.url}
          primary={
            <TextLink variant="external" href={row.url} text="inherit">
              {row.title || row.url}
            </TextLink>
          }
          secondary={row.domain}
          end={
            <span className="type-caption tabular-nums">{pluralCount(row.count, 'answer')}</span>
          }
        />
      ))}
    </Section>
  );
}

export function FanOutQueries({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <Section
      title="Fan-out queries"
      description="What the engines searched for while writing the answers that named it."
      empty={
        detail.fan_out_queries.length
          ? null
          : 'No search queries were captured for the answers that named it.'
      }
    >
      {detail.fan_out_queries.map((row) => (
        <Row
          key={row.query}
          primary={row.query}
          end={
            <span className="type-caption tabular-nums">{pluralCount(row.count, 'answer')}</span>
          }
        />
      ))}
    </Section>
  );
}

export function PromptMetrics({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <Section
      title="Prompts"
      description="Each prompt that named it or targets it, over that prompt's answers."
      empty={detail.prompts.length ? null : 'No prompt named it in this window.'}
    >
      {detail.prompts.map((row) => (
        <Row
          key={row.prompt_id ?? row.text}
          primary={row.text}
          secondary={
            <>
              Visibility <Measured value={row.visibility} format={formatRate} /> (
              {formatCount(row.appearances)} of {pluralCount(row.executions, 'answer')}) · Win rate{' '}
              <Measured value={row.win_rate} format={formatRate} /> · Position{' '}
              <Measured value={row.position} format={formatPosition} />
            </>
          }
        />
      ))}
    </Section>
  );
}

/** Each answer that named it, newest first; opening one shows the stored answer. */
export function Answers({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  const [open, setOpen] = useState<Answer | null>(null);
  const engines = useEngineCatalog();
  const more = detail.answer_total - detail.answers.length;
  return (
    <>
      <Section
        title="Answers"
        description={
          more > 0
            ? `The newest ${formatCount(detail.answers.length)} of ${pluralCount(detail.answer_total, 'answer')} that named it.`
            : 'Every answer that named it, newest first.'
        }
        empty={detail.answers.length ? null : 'No answer named it in this window.'}
      >
        {detail.answers.map((row) => (
          <Row
            key={row.task_id}
            primary={row.prompt_text}
            secondary={
              <>
                {engines.label(row.engine)} · <DisplayTime value={row.completed_at} dateOnly />
                {row.rank === null ? null : ` · #${row.rank}`}
              </>
            }
            end={
              <Inline gap="compact">
                <Badge variant="status" value={OUTCOMES[row.outcome].tone}>
                  {OUTCOMES[row.outcome].label}
                </Badge>
                <Button variant="ghost" onClick={() => setOpen(row)}>
                  Open answer
                </Button>
              </Inline>
            }
          />
        ))}
      </Section>
      <ExecutionEvidenceDrawer
        execution={open ? { id: open.task_id, prompt_text: open.prompt_text } : null}
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </>
  );
}
