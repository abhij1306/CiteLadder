'use client';

import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadError } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { missingPrompts, promptHistoryHref, type MissingPrompt } from '@/lib/prompts/history';
import { resolveProjectRequestScope } from '@/lib/project/request-scope';
import { engineLabel } from '@/lib/providers/catalog';

import { useLatestPromptMetrics } from '@/components/prompts/use-latest-prompt-measurements';

/** Rows shown on Overview; the rest are one click away in Prompts. */
const SHOWN = 5;

/**
 * Overview's "Where you're missing": prompts in the latest run (default
 * market) whose answers named a competitor but not the brand, with the
 * engines that did so and the Action that targets each prompt.
 */
export function MissingPrompts({
  projectId,
  workspaceId,
}: Readonly<{ projectId: string; workspaceId: string }>) {
  const query = useLatestPromptMetrics(resolveProjectRequestScope(workspaceId, projectId));
  const rows = useMemo(() => missingPrompts(query.data ?? []), [query.data]);
  // No run yet has nothing to compare, so the section stays out of the way.
  if (query.isPending || query.data?.length === 0) return null;
  return (
    <Card aria-labelledby="missing-prompts">
      <CardHeader
        actions={
          rows.length > SHOWN ? (
            <Button asChild variant="ghost">
              <ProjectLink href="/prompts">
                All prompts <ArrowRight className="ms-1 size-3.5" aria-hidden />
              </ProjectLink>
            </Button>
          ) : null
        }
      >
        <CardTitle id="missing-prompts">{"Where you're missing"}</CardTitle>
        <CardDescription>
          Prompts in the latest run where an answer named a competitor but not you.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {query.isError ? (
          <ReadError
            error={query.error}
            fallback="Prompt results could not be loaded."
            onRetry={() => void query.refetch()}
            pending={query.isFetching}
          />
        ) : null}
        {query.data && rows.length === 0 ? (
          <p className={textRole('caption')}>
            No answer in the latest run named a tracked competitor while leaving you out.
          </p>
        ) : null}
        {rows.length ? (
          <ul className={ledgerClasses('open')}>
            {rows.slice(0, SHOWN).map((row) => (
              <MissingRow key={row.promptId} row={row} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MissingRow({ row }: Readonly<{ row: MissingPrompt }>) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="grid min-w-0 gap-0.5">
        <TextLink href={promptHistoryHref(row.promptId)}>{row.text}</TextLink>
        <span className="type-caption">
          {row.engines.map(engineLabel).join(', ')} named {row.competitors.join(', ')}
        </span>
      </div>
      {row.actionId ? (
        <Button asChild variant="secondary">
          <ProjectLink href={`/agent/actions/${row.actionId}`}>Open the Action</ProjectLink>
        </Button>
      ) : (
        <span className="type-caption">No Action yet</span>
      )}
    </li>
  );
}
