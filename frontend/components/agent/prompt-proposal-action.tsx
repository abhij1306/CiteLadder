'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parsePromptProposal } from '@citeladder/contracts/prompt-proposal';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { promptsApi } from '@/lib/api/prompts';
import { queryKeys } from '@/lib/api/query-keys';
import { humanizeApiError } from '@/lib/api/errors';
import { admissionDropSummary } from '@/lib/prompts/admission';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { usePromptSet } from '@/lib/prompts/use-prompt-set';
import { PROMPTS_REVIEW_HREF } from '@/lib/prompts/routes';
import { MAX_GENERATION_COUNT } from '@/lib/config/prompts';

/**
 * Keep submission metadata out of the readable report; editing retains it.
 * A malformed or empty proposal stays visible so the user can repair it.
 */
export function promptPortfolioReport(body: string): string {
  const proposal = parsePromptProposal(body, MAX_GENERATION_COUNT);
  return proposal ? body.slice(0, proposal.start) + body.slice(proposal.end) : body;
}

/** How many questions the portfolio proposes (0 when it has no submittable block). */
export function proposedQuestionCount(body: string): number {
  return parsePromptProposal(body, MAX_GENERATION_COUNT)?.rows.length ?? 0;
}

/** Explicitly stage the saved revision; activation remains in candidate review. */
export function PromptProposalAction({
  workspaceId,
  revisionId,
  body,
  disabled,
}: Readonly<{
  workspaceId: string;
  revisionId: string;
  body: string;
  disabled: boolean;
}>) {
  const { ensurePromptSet } = usePromptSet();
  const client = useQueryClient();
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const stage = useMutation({
    mutationFn: async () => {
      const set = await ensurePromptSet();
      // Keep every approved question eligible; the default count would
      // silently trim a larger portfolio.
      const count = proposedQuestionCount(body);
      const result = await promptsApi.generate(
        set.id,
        { agent_revision_id: revisionId, ...(count ? { count } : {}) },
        { workspaceId },
      );
      await client.invalidateQueries({ queryKey: queryKeys.prompts.all });
      if (!result.candidates.length)
        throw new Error(
          [
            'No new questions passed admission.',
            admissionDropSummary(result.admission_drops),
            'Refine the portfolio or review suggestions already in Prompts.',
          ]
            .filter(Boolean)
            .join(' '),
        );
      navigate(projectHref(PROMPTS_REVIEW_HREF));
    },
  });
  return (
    <div className="grid gap-2">
      {stage.isError ? <Alert tone="warning">{humanizeApiError(stage.error).message}</Alert> : null}
      <Button
        className="justify-self-start"
        disabled={disabled}
        pending={stage.isPending}
        pendingLabel="Checking questions…"
        onClick={() => stage.mutate()}
      >
        Review in Prompts
      </Button>
    </div>
  );
}
