import { useState } from 'react';

import { AnswerDialog } from '@/components/runs/answer-dialog';
import { BrandMark } from '@/components/ui/brand-mark';
import { IconButton } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { StatusMark, type StatusValue } from '@/components/ui/status-mark';
import { DisplayTime } from '@/components/ui/display-time';
import { TableActionsCell, TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { Value } from '@/components/ui/value';
import type { CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { FileSearch } from '@/lib/icons';
import { formatCount, formatMean } from '@/lib/format';
import { formatRate, holderCaption } from '@/lib/products/product-columns';
import { productHref, type ProductScopeFilters } from '@/lib/products/product-filters';
import { useEngineCatalog } from '@/lib/providers/engines';

type Answer = CommerceProductDetail['answers'][number];

const OUTCOMES: Record<Answer['outcome'], { label: string; tone: StatusValue }> = {
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
  unranked: { label: 'Unranked', tone: 'info' },
};

const emptyWhen = (rows: readonly unknown[], message: string) =>
  rows.length ? undefined : ({ kind: 'empty', inline: true, message } as const);

const answers = { key: 'answers', label: 'Answers', kind: 'number' } as const;

const mean = (value: number | null) => (
  <Value value={value === null ? null : formatMean(value)} absent="unavailable" />
);
const rate = (value: number | null) => (
  <Value value={value === null ? null : formatRate(value)} absent="unavailable" />
);

const COMPETING_COLUMNS: readonly DataTableColumn[] = [
  { key: 'product', label: 'Product', kind: 'identity' },
  { key: 'shared', label: 'Shared answers', kind: 'number' },
  { key: 'ahead', label: 'Ranked above it', kind: 'number', priority: 'low' },
  { key: 'position', label: 'Position', kind: 'number' },
];

export function CompetingProducts({
  detail,
  scope,
}: Readonly<{ detail: CommerceProductDetail; scope: ProductScopeFilters }>) {
  const rows = detail.competing;
  return (
    <DataTable
      title="Competing products"
      columns={COMPETING_COLUMNS}
      state={emptyWhen(rows, 'No other product was named in its answers.')}
    >
      {rows.map((row) => (
        <TableRow key={row.holder_id}>
          <TableCell>
            <Inline as="span">
              {row.brand ? <BrandMark name={row.brand} placement="inline" /> : null}
              <TableCellLines
                primary={
                  <TextLink
                    href={productHref(row.holder_id, scope)}
                    text="inherit"
                    underline="hover"
                  >
                    {row.name}
                  </TextLink>
                }
                secondary={holderCaption(row)}
              />
            </Inline>
          </TableCell>
          <TableCell numeric>{formatCount(row.shared)}</TableCell>
          <TableCell numeric>{formatCount(row.ahead)}</TableCell>
          <TableCell numeric>{mean(row.position)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const MERCHANT_COLUMNS: readonly DataTableColumn[] = [
  { key: 'merchant', label: 'Merchant' },
  answers,
];

export function Merchants({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <DataTable
      title="Merchants"
      columns={MERCHANT_COLUMNS}
      state={emptyWhen(detail.merchants, 'No answer named a merchant for it.')}
    >
      {detail.merchants.map((row) => (
        <TableRow key={row.domain}>
          <TableCell>
            <TableCellLines primary={row.domain} />
          </TableCell>
          <TableCell numeric>{formatCount(row.count)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const SEEN_IN_COLUMNS: readonly DataTableColumn[] = [
  { key: 'name', label: 'Shopping prompt' },
  { key: 'kind', label: 'Kind', width: 'category', priority: 'low' },
  answers,
];

export function SeenIn({
  detail,
  scope,
}: Readonly<{ detail: CommerceProductDetail; scope: ProductScopeFilters }>) {
  return (
    <DataTable
      title="Seen in"
      columns={SEEN_IN_COLUMNS}
      state={emptyWhen(detail.seen_in, 'No shopping prompt’s answer named it.')}
    >
      {detail.seen_in.map((row) => (
        <TableRow key={row.target_id}>
          <TableCell>
            <TableCellLines
              primary={
                <TextLink href={productHref(row.target_id, scope)} text="inherit" underline="hover">
                  {row.name}
                </TextLink>
              }
            />
          </TableCell>
          <TableCell>{row.target_kind === 'category' ? 'Category' : 'Product'}</TableCell>
          <TableCell numeric>{formatCount(row.answers)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const SOURCE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'page', label: 'Page', kind: 'url' },
  answers,
];

export function Sources({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <DataTable
      title="Sources"
      columns={SOURCE_COLUMNS}
      state={emptyWhen(detail.sources, 'The answers that named it cited no pages.')}
    >
      {detail.sources.map((row) => (
        <TableRow key={row.url}>
          <TableCell>
            <TableCellLines
              primary={
                <TextLink variant="external" href={row.url} text="inherit">
                  {row.title || row.url}
                </TextLink>
              }
              secondary={row.domain}
            />
          </TableCell>
          <TableCell numeric>{formatCount(row.count)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const QUERY_COLUMNS: readonly DataTableColumn[] = [{ key: 'query', label: 'Query' }, answers];

export function FanOutQueries({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <DataTable
      title="Fan-out queries"
      columns={QUERY_COLUMNS}
      state={emptyWhen(
        detail.fan_out_queries,
        'No search queries were captured for the answers that named it.',
      )}
    >
      {detail.fan_out_queries.map((row) => (
        <TableRow key={row.query}>
          <TableCell>
            <TableCellLines primary={row.query} />
          </TableCell>
          <TableCell numeric>{formatCount(row.count)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const PROMPT_COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'visibility', label: 'Visibility', kind: 'number' },
  { key: 'appearances', label: 'Named in', kind: 'number', priority: 'low' },
  { key: 'win', label: 'Win rate', kind: 'number', priority: 'low' },
  { key: 'position', label: 'Position', kind: 'number' },
];

export function PromptMetrics({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <DataTable
      title="Prompts"
      columns={PROMPT_COLUMNS}
      state={emptyWhen(detail.prompts, 'No prompt named it in this window.')}
    >
      {detail.prompts.map((row) => (
        <TableRow key={row.prompt_id ?? row.text}>
          <TableCell>
            <TableCellLines primary={row.text} />
          </TableCell>
          <TableCell numeric>{rate(row.visibility)}</TableCell>
          <TableCell numeric>
            {formatCount(row.appearances)} of {formatCount(row.executions)}
          </TableCell>
          <TableCell numeric>{rate(row.win_rate)}</TableCell>
          <TableCell numeric>{mean(row.position)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const ANSWER_COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'engine', label: 'Engine', width: 'name', priority: 'low' },
  { key: 'date', label: 'Date', kind: 'date', priority: 'low' },
  { key: 'rank', label: 'Rank', kind: 'number', width: 'index' },
  { key: 'outcome', label: 'Outcome', kind: 'status' },
  { key: 'open', label: 'Open answer', kind: 'actions', width: 'action' },
];

export function Answers({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  const [open, setOpen] = useState<Answer | null>(null);
  const engines = useEngineCatalog();
  const more = detail.answer_total - detail.answers.length;
  return (
    <>
      <DataTable
        title="Answers"
        description={
          more > 0
            ? `Newest ${formatCount(detail.answers.length)} of ${formatCount(detail.answer_total)}`
            : undefined
        }
        columns={ANSWER_COLUMNS}
        state={emptyWhen(detail.answers, 'No answer named it in this window.')}
      >
        {detail.answers.map((row) => (
          <TableRow key={row.task_id}>
            <TableCell>
              <TableCellLines primary={row.prompt_text} />
            </TableCell>
            <TableCell>{engines.label(row.engine)}</TableCell>
            <TableCell>
              <DisplayTime value={row.completed_at} dateOnly />
            </TableCell>
            <TableCell numeric>
              <Value value={row.rank === null ? null : `#${row.rank}`} absent="unavailable" />
            </TableCell>
            <TableCell>
              <StatusMark variant="status" value={OUTCOMES[row.outcome].tone}>
                {OUTCOMES[row.outcome].label}
              </StatusMark>
            </TableCell>
            <TableActionsCell>
              <IconButton
                icon={FileSearch}
                variant="secondary"
                onClick={() => setOpen(row)}
                label={`Open the answer to ${row.prompt_text}`}
              />
            </TableActionsCell>
          </TableRow>
        ))}
      </DataTable>
      <AnswerDialog
        execution={open ? { id: open.task_id, prompt_text: open.prompt_text } : null}
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </>
  );
}
