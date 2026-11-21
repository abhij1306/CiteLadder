import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

import { Absence } from '@/components/ui/absence';
import { BrandMark } from '@/components/ui/brand-mark';
import { ClampText } from '@/components/ui/clamp-text';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { FigureStrip } from '@/components/ui/figure-strip';
import { HeatValue } from '@/components/ui/heat-value';
import { Inline, Stack } from '@/components/ui/layout';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { TableCell, TableRow, YouTag } from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { PERCEPTION_MIN_CLASSIFIED } from '@/lib/config/visibility';
import { percentText } from '@/lib/format';
import { themeAssociation, type ThemeCell } from '@/lib/visibility/theme-association';

const TITLE = 'How AI describes competitors';

const SHOWN_THEMES = 4;

export function CompetitorThemes({
  entities,
}: Readonly<{ entities: PerceptionResponse['entities'] }>) {
  const map = themeAssociation(entities);
  const marks = new Map(entities.map((entity) => [`${entity.is_brand}:${entity.name}`, entity]));
  const columns: readonly DataTableColumn[] = [
    { key: 'brand', label: 'Brand' },
    ...map.themes.map((theme, index): DataTableColumn => ({
      key: theme,
      label: theme,
      kind: 'number',
      width: 'figure',
      ...(index >= SHOWN_THEMES ? { priority: 'low' } : {}),
    })),
  ];
  return (
    <TitledSection title={TITLE}>
      <SectionContent>
        <Stack gap="item">
          <FigureStrip
            label="Theme association"
            segments={[
              {
                key: 'top',
                label: 'Your most associated theme',
                value: map.top?.theme ?? null,
                missingState: 'too_few',
                sub: map.top ? `${percentText(map.top.share)} of your mentions` : undefined,
              },
              {
                key: 'gap',
                label: 'Largest gap to the leader',
                value: map.gap?.theme ?? null,
                ...(map.top ? { missingLabel: 'No gap' } : { missingState: 'too_few' }),
                sub: map.gap ? `${map.gap.leader} ahead by ${map.gap.points} pts` : undefined,
              },
            ]}
          />
          <DataTable
            label={TITLE}
            columns={columns}
            state={
              map.themes.length
                ? undefined
                : { kind: 'empty', inline: true, message: 'No themes in these answers.' }
            }
          >
            {map.rows.map((row) => {
              const mark = marks.get(`${row.isBrand}:${row.name}`);
              return (
                <TableRow key={`${row.isBrand}:${row.name}`} highlight={row.isBrand}>
                  <TableCell>
                    <Inline as="span">
                      <BrandMark
                        name={row.name}
                        logoUrl={mark?.logo_url}
                        websiteUrl={mark?.website_url}
                      />
                      <ClampText lines={1} className={textRole('emphasis')}>
                        {row.name}
                      </ClampText>
                      {row.isBrand ? <YouTag /> : null}
                    </Inline>
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell key={map.themes[index]} numeric>
                      <HeatCell cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </DataTable>
        </Stack>
      </SectionContent>
    </TitledSection>
  );
}

function HeatCell({ cell }: Readonly<{ cell: ThemeCell }>) {
  if (cell.kind === 'too_few')
    return (
      <Absence
        state="too_few"
        reason={`Shows from ${PERCEPTION_MIN_CLASSIFIED} classified mentions; ${cell.classified} so far.`}
      />
    );
  return <HeatValue share={cell.share}>{percentText(cell.share)}</HeatValue>;
}
