import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { ReportPage } from '@/components/templates/report-page';
import { ProjectLink } from '@/components/ui/project-link';
import { Icon } from '@/components/ui/icon';
import { SLIP_FACE } from '@/components/ui/slip';
import { textRole } from '@/components/ui/typography';
import { Section, SectionHeader, SectionTitle } from '@/components/ui/section';
import {
  BarChart3,
  ChevronRight,
  FileText,
  Link2,
  ListChecks,
  ListTodo,
  Megaphone,
  MessageSquareText,
  PenLine,
  Search,
  Sparkles,
  Stethoscope,
  Wrench,
  type IconGlyph,
} from '@/lib/icons';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { skillGroupLabel } from '@/lib/agent/vocabulary';
import { agentQueries, type AgentSkill } from '@/lib/api/agent';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { cn } from '@/lib/utils';
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

export function SkillsScreen() {
  const { workspaceId } = useProjectScope();
  const query = useQuery(agentQueries.skills(workspaceId));

  let body;
  if (query.isError)
    body = (
      <StateBlock
        kind="error"
        {...readErrorProps(query)}
        title="Couldn't load skills"
        fallback="Skills could not be loaded."
      />
    );
  else if (!query.data) body = <StateBlock kind="loading" shape={{ kind: 'list' }} />;
  else body = <SkillGroups skills={query.data.skills} />;

  return <ReportPage>{body}</ReportPage>;
}

const OUTPUT_ICONS: Readonly<Record<string, IconGlyph>> = {
  plan: ListTodo,
  measurement: BarChart3,
  research: Search,
  prompt_plan: MessageSquareText,
  page_edits: PenLine,
  link_plan: Link2,
  technical_fix: Wrench,
  diagnosis: Stethoscope,
  earned_brief: Megaphone,
  content: FileText,
  page: ListChecks,
};

function SkillGroups({ skills }: Readonly<{ skills: AgentSkill[] }>) {
  const { outputKind } = useAgentCatalog();
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of skills) {
    const label = skillGroupLabel(skill.group);
    groups.set(label, [...(groups.get(label) ?? []), skill]);
  }
  return (
    <div className="min-w-0">
      {[...groups].map(([group, rows]) => (
        <Section key={group} aria-label={group}>
          <SectionHeader>
            <SectionTitle level={2}>
              {group} <span className="text-ink-2">({rows.length})</span>
            </SectionTitle>
          </SectionHeader>
          <ul className={cn(SLIP_FACE, 'divide-rule divide-y overflow-hidden')}>
            {rows.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                output={outputKind(skill.output_kind)?.label}
              />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function SkillRow({ skill, output }: Readonly<{ skill: AgentSkill; output: string | undefined }>) {
  const detailId = useId();
  return (
    <li className="hover:overlay-hover relative flex min-h-[var(--table-row-height)] min-w-0 items-center gap-3 px-4 py-2.5">
      <Icon icon={OUTPUT_ICONS[skill.output_kind] ?? Sparkles} className="text-ink-2" />
      <span className={textRole('body', 'flex min-w-0 flex-1 flex-col gap-0.5')}>
        <ProjectLink
          href={agentHandoffHref({ skillId: skill.id })}
          aria-label={`Start a chat with ${skill.label}`}
          aria-describedby={output ? `${detailId} ${detailId}-output` : detailId}
          className="focus-ring-inset type-label text-ink self-start no-underline before:absolute before:inset-0"
        >
          {skill.label}
        </ProjectLink>
        <span id={detailId} className="text-ink-2 phone:sr-only line-clamp-2 min-w-0">
          {skill.description}
        </span>
      </span>
      {output ? (
        <span
          id={`${detailId}-output`}
          className={textRole('caption', 'shrink-0 whitespace-nowrap')}
        >
          <span className="sr-only">Output:</span> {output}
        </span>
      ) : null}
      <Icon icon={ChevronRight} className="text-ink-2" />
    </li>
  );
}
