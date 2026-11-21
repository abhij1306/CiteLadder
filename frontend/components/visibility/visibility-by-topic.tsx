import type { UseQueryResult } from '@tanstack/react-query';

import type { VisibilityTopics } from '@citeladder/contracts/visibility-topics';
import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { readErrorProps } from '@/components/ui/notice';
import { Pressable } from '@/components/ui/pressable';
import { TitledSection } from '@/components/ui/section';
import { TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { Tags } from '@/lib/icons';
import { SHARE_OF_VOICE_HINT } from '@/lib/config/visibility';
import { formatCount } from '@/lib/format';
import { formatPositionExact, formatRate } from '@/lib/visibility/dashboard';
import { READING_LABELS } from '@/lib/visibility/matrix';

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'topic', label: 'Topic' },
  { key: 'answers', label: 'Answers', width: 'figure', kind: 'number' },
  { key: 'visibility', label: 'Visibility', width: 'figure', kind: 'number' },
  {
    key: 'voice',
    label: 'Share of voice',
    hint: SHARE_OF_VOICE_HINT,
    width: 'metric',
    kind: 'number',
  },
  { key: 'position', label: 'Position', width: 'figure', kind: 'number' },
  { key: 'rank', label: 'Your rank', width: 'figure', kind: 'number' },
];
const VALUE_KEYS = COLUMNS.slice(1).map((column) => column.key);

function topicsState(query: UseQueryResult<VisibilityTopics>): DataTableState | undefined {
  if (query.isError)
    return {
      kind: 'error',
      ...readErrorProps(query),
      title: "Couldn't load the topics",
      fallback: 'The request failed or timed out.',
    };
  if (query.isPending) return { kind: 'loading', label: 'Loading topics…' };
  if (query.data.items.length === 0)
    return { kind: 'empty', headingLevel: 3, icon: Tags, heading: 'No topics yet' };
  return undefined;
}

export function VisibilityByTopic({
  query,
  topic,
  onSelectTopic,
}: Readonly<{
  query: UseQueryResult<VisibilityTopics>;
  topic: string | null;
  onSelectTopic: (topic: string) => void;
}>) {
  return (
    <TitledSection title="By topic">
      <DataTable label="By topic" columns={COLUMNS} state={topicsState(query)}>
        {(query.data?.items ?? []).map((row) => (
          <TableRow key={row.topic_id}>
            <TableCell>
              <TextLink asChild text="inherit" underline="hover">
                <Pressable
                  className="w-auto"
                  aria-current={row.topic_id === topic ? 'true' : undefined}
                  onClick={() => onSelectTopic(row.topic_id)}
                >
                  {row.name}
                </Pressable>
              </TextLink>
              {row.renamed_from.length ? (
                <span className="text-ink-2">
                  {' · was '}
                  {row.renamed_from.map((name) => `“${name}”`).join(', ')}
                </span>
              ) : null}
            </TableCell>
            {row.kind === 'measured' ? (
              <>
                <TableCell numeric>{formatCount(row.answers)}</TableCell>
                <TableCell numeric>{formatRate(row.visibility_rate)}</TableCell>
                <TableCell numeric>{formatRate(row.share_of_voice)}</TableCell>
                <TableCell numeric>{formatPositionExact(row.avg_position)}</TableCell>
                <TableCell numeric>
                  {row.rank === null ? (
                    <Absence reason="No tracked brand was named" />
                  ) : (
                    `${row.rank} of ${row.ranked_brands}`
                  )}
                </TableCell>
              </>
            ) : (
              VALUE_KEYS.map((key) => (
                <TableCell key={key} numeric>
                  <Absence state="not_run" label={READING_LABELS.not_run} />
                </TableCell>
              ))
            )}
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}
