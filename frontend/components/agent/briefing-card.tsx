import { useQuery } from '@tanstack/react-query';

import type { NewChatInput } from '@/components/agent/use-chat-turns';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { Sparkles } from '@/lib/icons';
import { actionsQueries } from '@/lib/api/actions';
import { AGENT_BRIEFING_ACTIONS } from '@/lib/config/agent';

const BRIEFING_REQUEST =
  'What should I work on this week? Brief me on the highest-value work, why each item matters with its evidence, and the first step for each.';

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
  const actions = useQuery(actionsQueries.list({ workspaceId, projectId }));
  const top = actions.data?.items.slice(0, AGENT_BRIEFING_ACTIONS) ?? [];
  const actionLabel = top.length === 1 ? 'Action' : 'Actions';
  const basis = top.length > 0 ? `Reads your top ${top.length} open ${actionLabel}.` : null;
  return (
    <Stack as="section" aria-labelledby="agent-briefing">
      <Stack gap="tight">
        <h2 id="agent-briefing" className={textRole('subheading')}>
          What should I work on?
        </h2>
        {basis ? <p className={textRole('body', 'text-ink-2')}>{basis}</p> : null}
      </Stack>
      <Button
        variant="secondary"
        className="justify-self-start"
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
        <Icon icon={Sparkles} />
        Brief me
      </Button>
    </Stack>
  );
}
