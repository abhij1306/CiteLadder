import { useMemo } from 'react';

import { Absence } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { StateBlock } from '@/components/ui/state-block';
import { TextLink } from '@/components/ui/text-link';
import { missingPrompts, promptHistoryHref, type MissingPrompt } from '@/lib/prompts/history';
import { useEngineCatalog } from '@/lib/providers/engines';

import { useLatestPromptMetrics } from '@/components/prompts/use-latest-prompt-measurements';
import { Notice, readErrorProps } from '@/components/ui/notice';

import { WidgetFrame } from './widget-frame';

const SHOWN = 5;

export function MissingPrompts({
  projectId,
  workspaceId,
}: Readonly<{ projectId: string; workspaceId: string }>) {
  const query = useLatestPromptMetrics({ workspaceId, projectId });
  const rows = useMemo(() => missingPrompts(query.data ?? []), [query.data]);
  return (
    <WidgetFrame
      id="missing-prompts"
      title="Where you're missing"
      link={rows.length > SHOWN ? { href: '/prompts', label: 'All prompts' } : null}
      card={rows.length > 0}
    >
      <MissingBody query={query} rows={rows} />
    </WidgetFrame>
  );
}

function MissingBody({
  query,
  rows,
}: Readonly<{
  query: ReturnType<typeof useLatestPromptMetrics>;
  rows: readonly MissingPrompt[];
}>) {
  if (query.isError)
    return (
      <Notice
        kind="read"
        title="Couldn't load prompt results"
        {...readErrorProps(query)}
        fallback="Prompt results could not be loaded."
      />
    );
  if (query.isPending)
    return <StateBlock kind="loading" label="Loading prompt results" shape={{ kind: 'list' }} />;
  if (query.data.length === 0)
    return <StateBlock kind="empty" inline message="No measured run yet." />;
  if (rows.length === 0)
    return (
      <StateBlock
        kind="empty"
        inline
        message="No answer in the latest run named a tracked competitor while leaving you out."
      />
    );
  return (
    <LedgerList>
      {rows.slice(0, SHOWN).map((row) => (
        <MissingRow key={row.promptId} row={row} />
      ))}
    </LedgerList>
  );
}

function MissingRow({ row }: Readonly<{ row: MissingPrompt }>) {
  const engines = useEngineCatalog();
  return (
    <LedgerItem
      title={
        <TextLink href={promptHistoryHref(row.promptId)} underline="hover" className="flex min-w-0">
          <ClampText phoneWrap>{row.text}</ClampText>
        </TextLink>
      }
      caption={
        <ClampText
          phoneWrap
        >{`${row.engines.map(engines.label).join(', ')} named ${row.competitors.join(', ')}`}</ClampText>
      }
      meta={
        row.actionId ? (
          <TextLink
            href={`/actions/${row.actionId}`}
            underline="hover"
            aria-label={`Open Action for ${row.text}`}
          >
            Open Action
          </TextLink>
        ) : (
          <Absence state="none" label="No Action yet" />
        )
      }
    />
  );
}
