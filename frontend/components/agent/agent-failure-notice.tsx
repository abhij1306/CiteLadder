import { Notice } from '@/components/ui/notice';
import { TextLink } from '@/components/ui/text-link';
import type { AgentWriteFailure } from '@/lib/agent/errors';
import { useManagedPlan } from '@/lib/billing/entitlement-context';

export function AgentFailureNotice({
  failure,
  newChatHref,
}: Readonly<{ failure: AgentWriteFailure; newChatHref?: string }>) {
  const managed = useManagedPlan();
  return (
    <Notice
      kind="mutation"
      notice={failure}
      recovery={recoveryLink(failure, managed, newChatHref)}
    />
  );
}

function recoveryLink(
  failure: AgentWriteFailure,
  managed: boolean,
  newChatHref: string | undefined,
) {
  switch (failure.recovery) {
    case 'new-chat':
      return newChatHref ? <TextLink href={newChatHref}>Start a new chat</TextLink> : null;
    case 'connect-model':
      return managed ? (
        <TextLink href="/billing">Open Billing</TextLink>
      ) : (
        <TextLink href="/settings?tab=providers">Connect a model</TextLink>
      );
    case null:
      return null;
    default: {
      const unreachable: never = failure.recovery;
      return unreachable;
    }
  }
}
