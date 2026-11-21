import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  ContextualLinkDeclarationRoute,
  isDeclarable,
  useMarkImplemented,
} from '@/components/agent/action-declaration';
import { ACTIONS } from '@/components/ui/actions';
import { Button, buttonClasses } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { DOCK_SLOT, PageDock } from '@/components/ui/selection-dock';
import { useToast } from '@/components/ui/toast';
import { Check, RotateCcw, Sparkles, X, type IconGlyph } from '@/lib/icons';
import { actionsApi, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { queryKeys } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import type { ActionUserStatus } from '@citeladder/contracts/actions';

type Decision = Readonly<{ label: string; icon: IconGlyph; to: ActionUserStatus }>;
const ACCEPT: Decision = { label: 'Accept', icon: Check, to: 'in_progress' };
const DECLINE: Decision = { label: 'Decline', icon: X, to: 'dismissed' };
const RESTORE: Decision = { label: 'Restore', icon: RotateCcw, to: 'open' };

const DOCK_SLOTS: Record<
  ActionDetail['status'],
  readonly [Decision | null, Decision | 'declare' | null]
> = {
  open: [DECLINE, ACCEPT],
  in_progress: [DECLINE, 'declare'],
  dismissed: [RESTORE, ACCEPT],
  done: [null, null],
};

const ANNOUNCED: Record<ActionUserStatus, string> = {
  in_progress: 'Action accepted. It is in progress.',
  dismissed: 'Action declined. Restore puts it back in New.',
  open: 'Action restored to New.',
};

const FIRST = DOCK_SLOT.decision;
const SECOND = DOCK_SLOT.wide;

export function ActionDock({
  action,
  workspaceId,
  agentHref,
  agentLabel,
}: Readonly<{
  action: ActionDetail;
  workspaceId: string;
  agentHref: string;
  agentLabel: string;
}>) {
  const mayWrite = useWorkspaceCapability('write');
  const decide = useDecision(action, workspaceId);
  const markImplemented = useMarkImplemented({ workspaceId, action, revision: null });
  const [first, second] = mayWrite ? DOCK_SLOTS[action.status] : [null, null];
  const linkRoute = action.members.some((member) => member.rule_id === 'site_contextual_links');
  const slot = (decision: Decision | null, width: string) =>
    decision ? (
      <Button
        variant="quiet"
        className={width}
        aria-disabled={decide.isPending || undefined}
        onClick={() => {
          if (!decide.isPending) decide.mutate(decision.to);
        }}
      >
        <Icon icon={decision.icon} />
        {decision.label}
      </Button>
    ) : (
      <span aria-hidden className={cn(width, 'shrink-0')} />
    );
  let declare = slot(null, SECOND);
  if (second === 'declare' && isDeclarable(action))
    declare = linkRoute ? (
      <ContextualLinkDeclarationRoute className={SECOND} />
    ) : (
      <Button variant="quiet" className={SECOND} onClick={markImplemented.start}>
        <Icon icon={ACTIONS.markImplemented.icon} />
        {ACTIONS.markImplemented.label}
      </Button>
    );
  return (
    <PageDock label="Work on this action">
      <output className="sr-only">{decide.isSuccess ? ANNOUNCED[decide.variables] : null}</output>
      {slot(first, FIRST)}
      {second === 'declare' ? declare : slot(second, SECOND)}
      <ProjectLink href={agentHref} className={buttonClasses('primary', DOCK_SLOT.primary)}>
        <Icon icon={Sparkles} />
        <span className={DOCK_SLOT.primaryLabel}>{agentLabel}</span>
      </ProjectLink>
      {markImplemented.dialog}
    </PageDock>
  );
}

function useDecision(action: ActionDetail, workspaceId: string) {
  const client = useQueryClient();
  const toast = useToast();
  const { queryKey } = actionsQueries.detail(workspaceId, action.id);
  return useMutation({
    mutationFn: (to: ActionUserStatus) => actionsApi.updateStatus(action.id, to, { workspaceId }),
    onMutate: async (to) => {
      await client.cancelQueries({ queryKey });
      const before = client.getQueryData(queryKey);
      client.setQueryData(queryKey, (current) =>
        current ? { ...current, status: to, measurement: null } : current,
      );
      return { before };
    },
    onError: (_error, _to, context) => {
      client.setQueryData(queryKey, context?.before);
      toast.notify("Couldn't change this action", 'It keeps its current status.', {
        tone: 'negative',
      });
    },
    onSuccess: (updated) => {
      client.setQueryData(queryKey, (current) =>
        current
          ? { ...current, status: updated.status, measurement: updated.measurement }
          : current,
      );
      void client.invalidateQueries({ queryKey: queryKeys.actions.all });
    },
  });
}
