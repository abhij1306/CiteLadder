import type { FailureOutcome } from '@/components/agent/thread-items';
import type { AgentMessage } from '@/lib/api/agent';
import { DisplayTime } from '@/components/ui/display-time';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { ContentMarkdown } from '@/lib/markdown/markdown';

const FAILURE_VERB: Record<FailureOutcome, string> = {
  failed: 'Failed',
  stopped_at_limit: 'Hit the step limit',
  cancelled: 'Stopped',
  unknown: 'Did not finish',
};
const FAILURE_TONE: Record<FailureOutcome, NoticeTone> = {
  failed: 'negative',
  stopped_at_limit: 'warning',
  cancelled: 'warning',
  unknown: 'info',
};

export function TurnFailure({
  failures,
  outcome,
}: Readonly<{ failures: [AgentMessage, ...AgentMessage[]]; outcome: FailureOutcome }>) {
  const latest = failures.at(-1) ?? failures[0];
  const count = failures.length;
  const time = <DisplayTime value={latest.created_at} />;
  const verb = FAILURE_VERB[outcome];
  return (
    <Notice
      tone={FAILURE_TONE[outcome]}
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
      <ContentMarkdown markdown={latest.content} density="compact" />
    </Notice>
  );
}
