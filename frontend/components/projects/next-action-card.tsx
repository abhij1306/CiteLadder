import type { ReactNode } from 'react';
import { ProjectLink } from '@/components/ui/project-link';

import { ActionButton, ACTIONS } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { textRole } from '@/components/ui/typography';
import { ArrowRight } from '@/lib/icons';
import { pluralCount } from '@/lib/format';
import type { CommandCenter } from '@citeladder/contracts';

import { ActionFacts } from './dashboard-primitives';
import { WidgetFrame } from './widget-frame';

const NEXT_ACTION_LINK: Record<CommandCenter['next_action']['kind'], string> = {
  opportunity: ACTIONS.openAction.label,
  connect: 'Open Integrations',
  crawl: 'Open Site health',
  configure_prompts: ACTIONS.addPrompts.label,
  audit: 'Open Runs',
  audit_running: 'View progress',
  monitor: 'View trends',
};

function nextActionEvidence(data: CommandCenter): ReactNode {
  const step = data.next_action;
  switch (step.kind) {
    case 'opportunity': {
      const action = data.actions.find((item) => item.id === step.opportunity_id);
      return action ? <ActionFacts action={action} /> : null;
    }
    case 'audit':
    case 'audit_running':
      return (
        <p className={textRole('caption')}>
          {pluralCount(data.active_prompt_count, 'active prompt')} to measure
        </p>
      );
    case 'crawl':
      return captionOrNull(data.loop.analyzed.limitations[0]);
    case 'connect':
      return captionOrNull(data.loop.connected.limitations[0]);
    case 'monitor':
      return data.measurement ? (
        <p className={textRole('caption')}>
          Last run <DisplayTime value={data.measurement.completed_at} />
        </p>
      ) : null;
    case 'configure_prompts':
      return null;
    default:
      return step.kind satisfies never;
  }
}

function captionOrNull(text: string | undefined) {
  return text ? <p className={textRole('caption')}>{text}</p> : null;
}

export function NextAction({ data }: Readonly<{ data: CommandCenter }>) {
  const step = data.next_action;
  const listOnly = step.kind === 'opportunity' && step.href === '/actions';
  return (
    <WidgetFrame id="next-action" title="Next action">
      <p className={textRole('label')}>{step.title}</p>
      {nextActionEvidence(data)}
      <div>
        {step.kind === 'opportunity' && !listOnly ? (
          <ActionButton action="openAction" href={step.href} />
        ) : (
          <Button asChild variant="secondary">
            <ProjectLink href={step.href}>
              {listOnly ? 'Open Actions' : NEXT_ACTION_LINK[step.kind]}
              <Icon icon={ArrowRight} />
            </ProjectLink>
          </Button>
        )}
      </div>
    </WidgetFrame>
  );
}
