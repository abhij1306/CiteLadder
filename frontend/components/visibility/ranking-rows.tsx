import { useNavigate } from 'react-router-dom';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { ClampText } from '@/components/ui/clamp-text';
import { TableCell, TableRow, YouTag } from '@/components/ui/table';
import { BrandMark } from '@/components/ui/brand-mark';
import { CellMeter } from '@/components/ui/meter';
import { Absence } from '@/components/ui/absence';
import type { RankingRow } from '@citeladder/contracts';
import { Users } from '@/lib/icons';
import { SHARE_OF_VOICE_HINT, WIN_RATE_HINT } from '@/lib/config/visibility';
import { percentText } from '@/lib/format';
import { formatPositionExact, formatRate } from '@/lib/visibility/dashboard';
import {
  competitorHref,
  orderByVisibility,
  rankingRowKey,
  winRateAbsence,
} from '@/lib/visibility/ranking';
import { Delta } from '@/components/ui/delta';
import { textRole } from '@/components/ui/typography';
import { TitledSection } from '@/components/ui/section';
import { SentimentValue } from '@/components/visibility/sentiment-value';
import { TextLink } from '@/components/ui/text-link';

const TITLE = 'You and your competitors';

const SENTIMENT_HINT =
  'Net sentiment: positive minus negative mentions, as a share of the classified mentions of each brand, from −100 to +100.';

const POSITION_HINT =
  'Where a brand tends to appear among the brands you track, averaged over the answers that name it. 1.0 means it is named first every time.';

export function RankingRowsTable({
  rows,
  description,
}: Readonly<{
  rows: readonly RankingRow[];
  description?: string;
}>) {
  const navigate = useNavigate();
  const ordered = orderByVisibility(rows);
  const anyPosition = ordered.some((row) => row.avg_position != null);
  const anySentiment = ordered.some((row) => row.sentiment != null);
  return (
    <TitledSection title={TITLE} description={description}>
      <DataTable
        label={TITLE}
        columns={rankingColumns({ anyPosition, anySentiment })}
        state={
          ordered.length
            ? undefined
            : {
                kind: 'empty',
                headingLevel: 3,
                icon: Users,
                heading: 'No measured responses in this selection',
              }
        }
      >
        {ordered.map((row) => {
          const change = row.matched_visibility_delta ?? row.visibility_delta;
          return (
            <TableRow
              key={rankingRowKey(row)}
              highlight={row.is_brand}
              {...(row.is_brand
                ? {}
                : {
                    className: 'cursor-pointer',
                    onClick: () => navigate(competitorHref(row.name)),
                  })}
            >
              <TableCell>
                <Inline as="span">
                  <BrandMark name={row.name} logoUrl={row.logo_url} websiteUrl={row.website_url} />
                  <ClampText lines={1} className={textRole('emphasis')}>
                    {row.is_brand ? (
                      row.name
                    ) : (
                      <TextLink
                        href={competitorHref(row.name)}
                        text="inherit"
                        underline="hover"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.name}
                      </TextLink>
                    )}
                  </ClampText>
                  {row.is_brand ? <YouTag /> : null}
                </Inline>
              </TableCell>
              <TableCell numeric>
                <VisibilityValue row={row} />
              </TableCell>
              <TableCell numeric>{formatRate(row.share_of_voice)}</TableCell>
              {anyPosition ? (
                <TableCell numeric>{formatPositionExact(row.avg_position ?? null)}</TableCell>
              ) : null}
              <TableCell numeric>
                <WinRateValue row={row} />
              </TableCell>
              {anySentiment ? (
                <TableCell numeric>
                  <SentimentValue sentiment={row.sentiment} />
                </TableCell>
              ) : null}
              <TableCell numeric>
                <Delta value={change} unit=" pp" />
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </TitledSection>
  );
}

function VisibilityValue({ row }: Readonly<{ row: RankingRow }>) {
  if (row.mention_rate == null) return <Absence />;
  const value = percentText(row.mention_rate);
  return (
    <Inline as="span" className="justify-end">
      <CellMeter
        label={`${row.name} visibility`}
        value={row.mention_rate}
        max={1}
        valueText={value}
        tone={row.is_brand ? 'accent' : 'ink'}
      />
      <span>{value}</span>
    </Inline>
  );
}

function WinRateValue({ row }: Readonly<{ row: RankingRow }>) {
  if (row.win_rate != null) return <span>{percentText(row.win_rate)}</span>;
  return <Absence state={winRateAbsence(row)} />;
}

export function RankingRowsPending({ brands }: Readonly<{ brands: number }>) {
  return (
    <TitledSection title={TITLE}>
      <DataTable
        label={TITLE}
        columns={rankingColumns({ anyPosition: true, anySentiment: true })}
        pageSize={brands}
        state={{ kind: 'loading', label: 'Loading the rankings…' }}
      />
    </TitledSection>
  );
}

function rankingColumns({
  anyPosition,
  anySentiment,
}: Readonly<{
  anyPosition: boolean;
  anySentiment: boolean;
}>): DataTableColumn[] {
  return [
    { key: 'brand', label: 'Brand', kind: 'identity' },
    { key: 'visibility', label: 'Visibility', width: 'name', kind: 'number' },
    {
      key: 'sov',
      label: 'Share of voice',
      hint: SHARE_OF_VOICE_HINT,
      width: 'shortMetric',
      kind: 'number',
    },
    ...(anyPosition
      ? [
          {
            key: 'position',
            label: 'Position',
            hint: POSITION_HINT,
            width: 'figure',
            kind: 'number',
          } as const,
        ]
      : []),
    { key: 'win_rate', label: 'Win rate', hint: WIN_RATE_HINT, width: 'figure', kind: 'number' },
    ...(anySentiment
      ? [
          {
            key: 'sentiment',
            label: 'Sentiment',
            hint: SENTIMENT_HINT,
            width: 'metric',
            kind: 'number',
          } as const,
        ]
      : []),
    { key: 'change', label: 'Change', width: 'figure', kind: 'number' },
  ];
}
