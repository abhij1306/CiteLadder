import type { CommandCenter } from '@citeladder/contracts';
import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { ActionButton, ACTIONS } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { SetupSteps, type SetupStep } from '@/components/ui/rung-trail';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import { textRole } from '@/components/ui/typography';
import { ArrowRight } from '@/lib/icons';
import { PROMPT_BUILDER_HREF } from '@/lib/prompts/routes';

export const reached = (stage: CommandCenter['loop']['connected']) =>
  stage.state === 'observed' || stage.state === 'partial';

export function needsStart(data: CommandCenter): boolean {
  return !data.measurement || data.active_prompt_count === 0;
}

function startSteps(data: CommandCenter): SetupStep[] {
  const running = data.next_action.kind === 'audit_running';
  const steps = [
    { id: 'prompts', label: ACTIONS.addPrompts.label, done: data.active_prompt_count > 0 },
    { id: 'run', label: ACTIONS.launchRun.label, done: Boolean(data.measurement) },
    { id: 'crawl', label: 'Run crawl', done: reached(data.loop.analyzed) },
    {
      id: 'connect',
      label: 'Connect Search Console or GA4',
      done: reached(data.loop.connected),
    },
  ] as const;
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index): SetupStep => {
    if (step.done) return { id: step.id, label: step.label, state: 'done' };
    if (index !== current) return { id: step.id, label: step.label, state: 'waiting' };
    return {
      id: step.id,
      label: step.label,
      state: step.id === 'run' && running ? 'running' : 'next',
      action: <StartButton data={data} />,
    };
  });
}

export function OverviewStart({ data }: Readonly<{ data: CommandCenter }>) {
  const firstRun = !data.measurement;
  const steps = startSteps(data);
  const done = steps.filter((step) => step.state === 'done').length;
  return (
    <Section aria-labelledby="overview-start">
      <SectionHeader
        actions={
          <span className={textRole('caption', 'flex h-6 items-center tabular-nums')}>
            {done} of {steps.length} done
          </span>
        }
      >
        <SectionTitle id="overview-start">
          {firstRun ? 'Get your first results' : 'Track prompts again'}
        </SectionTitle>
      </SectionHeader>
      <SetupSteps label="Steps to your first results" steps={steps} />
    </Section>
  );
}

function StartButton({ data }: Readonly<{ data: CommandCenter }>) {
  if (data.active_prompt_count === 0)
    return <ActionButton action="addPrompts" href={PROMPT_BUILDER_HREF} />;
  if (data.next_action.kind === 'audit_running')
    return (
      <Button asChild variant="secondary">
        <ProjectLink href={data.next_action.href}>
          View progress
          <Icon icon={ArrowRight} />
        </ProjectLink>
      </Button>
    );
  return <LaunchAuditButton secondary />;
}
