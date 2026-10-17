'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import type { NewChatInput } from '@/components/agent/use-chat-turns';
import { Button } from '@/components/ui/button';
import { panelClasses } from '@/components/ui/panel';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { actionsQueries } from '@/lib/api/actions';
import { AGENT_BRIEFING_ACTIONS } from '@/lib/config/agent';

const BRIEFING_REQUEST =
  'What should I work on this week? Brief me on the highest-value work, why each item matters with its evidence, and the first step for each.';

/**
 * "What should I work on?": one click starts a growth-plan chat that mentions
 * the project's top open Actions, so their diagnoses are in its context. It
 * runs only when the user asks; nothing is scheduled.
 */
export function BriefingCard({
  workspaceId,
  projectId,
  onStart,
  pending,
  disabled,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  onStart: (input: NewChatInput) => void;
  pending: boolean;
  disabled: boolean;
}>) {
  const actions = useQuery(actionsQueries.list(workspaceId, projectId));
  const top = actions.data?.items.slice(0, AGENT_BRIEFING_ACTIONS) ?? [];
  const actionLabel = top.length === 1 ? 'Action' : 'Actions';
  const basis =
    top.length > 0
      ? `Reads your evidence and your top ${top.length} open ${actionLabel}.`
      : 'Reads your evidence across Visibility, Site Health, Demand and Performance.';
  return (
    <section aria-labelledby="agent-briefing" className={panelClasses({ pad: 'compact' })}>
      <EditorialSectionHeader
        title="What should I work on?"
        headingId="agent-briefing"
        description={`${basis} Runs once when you ask; nothing is scheduled.`}
        actions={
          <Button
            disabled={disabled || pending || actions.isPending}
            onClick={() =>
              onStart({
                message: BRIEFING_REQUEST,
                skillId: 'growth_plan',
                context: {},
                mentions: top.map((action) => action.id),
              })
            }
          >
            <Sparkles className="size-4" aria-hidden />
            Brief me
          </Button>
        }
      />
    </section>
  );
}
