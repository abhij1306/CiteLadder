import { AlertTriangle } from 'lucide-react';

import { MessageTime } from '@/components/agent/message-time';
import type { FailureOutcome } from '@/components/agent/thread-items';
import { Callout, type CalloutTone } from '@/components/ui/callout';
import type { AgentMessage } from '@/lib/api/agent';

const FAILURE_VERB: Record<FailureOutcome, string> = {
  failed: 'Failed',
  stopped_at_limit: 'Hit the step limit',
  cancelled: 'Stopped',
  unknown: 'Did not finish',
};
const FAILURE_TONE: Record<FailureOutcome, CalloutTone> = {
  failed: 'negative',
  stopped_at_limit: 'warning',
  cancelled: 'warning',
  unknown: 'neutral',
};

/**
 * An unanswered turn, in place of a reply: how it ended, how many attempts
 * ended so and when the last did, then the run's own explanation. Only the
 * latest turn's outcome is known, so only it is an alert (announced once, when
 * it appears or another attempt joins it); an earlier one is a quiet note.
 */
export function TurnFailure({
  failures,
  outcome,
}: Readonly<{ failures: [AgentMessage, ...AgentMessage[]]; outcome: FailureOutcome }>) {
  const latest = failures.at(-1) ?? failures[0];
  const count = failures.length;
  const time = <MessageTime value={latest.created_at} />;
  const verb = FAILURE_VERB[outcome];
  return (
    <Callout
      tone={FAILURE_TONE[outcome]}
      icon={outcome === 'unknown' ? AlertTriangle : undefined}
      title={
        count > 1 ? (
          <>
            {verb} {count} times, last at {time}
          </>
        ) : (
          <>
            {verb} at {time}
          </>
        )
      }
    >
      {latest.content}
    </Callout>
  );
}
