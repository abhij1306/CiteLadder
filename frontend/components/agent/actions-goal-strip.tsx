import { FigureStrip } from '@/components/ui/figure-strip';
import { InfoHint } from '@/components/ui/info-hint';
import { StatusMark } from '@/components/ui/status-mark';
import { textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';
import {
  ACTION_GOAL_HINT,
  ACTION_GOAL_LABEL,
  goalCountPhrase,
  goalCountWords,
} from '@/lib/agent/vocabulary';
import type { ActionTree } from '@/lib/api/actions';
import { actionGoalSchema, type ActionGoal } from '@citeladder/contracts/actions';

export function GoalStrip({
  goals,
  failed,
  onJump,
}: Readonly<{
  goals: ActionTree['goals'] | undefined;
  failed: boolean;
  onJump: (goal: ActionGoal) => void;
}>) {
  return (
    <FigureStrip
      label="Goals"
      twoLineLabels
      segments={actionGoalSchema.options.map((goal) => {
        const entry = failed ? undefined : goals?.find((candidate) => candidate.goal === goal);
        const label = ACTION_GOAL_LABEL[goal];
        const phrase = entry ? goalCountPhrase(goal, entry.count) : null;
        return {
          key: goal,
          label: <span className={textRole('body', 'text-ink')}>{label}</span>,
          loading: !failed && !goals,
          value: entry ? (
            <span className="flex min-w-0 items-baseline gap-2" title={phrase ?? undefined}>
              <span className="shrink-0">{formatCount(entry.count)}</span>
              <span className={textRole('caption', 'min-w-0 truncate')}>
                {goalCountWords(goal, entry.count)}
              </span>
            </span>
          ) : null,
          missingState: 'unavailable',
          marker: (
            <>
              {entry?.blocking ? (
                <StatusMark variant="severity" value="critical">
                  Blocking
                </StatusMark>
              ) : null}
              <InfoHint label={`About ${label}`}>{ACTION_GOAL_HINT[goal]}</InfoHint>
            </>
          ),
          actionLabel: [`Go to ${label}`, phrase, entry?.blocking ? 'blocking' : null]
            .filter(Boolean)
            .join(', '),
          onSelect: () => onJump(goal),
        };
      })}
    />
  );
}
