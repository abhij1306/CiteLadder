'use client';

import { useQuery } from '@tanstack/react-query';

import { PageLoading } from '@/components/layout/page-loading';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { PageShell } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { ReadError } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { skillGroupLabel } from '@/lib/agent/vocabulary';
import { agentQueries, type AgentSkill } from '@/lib/api/agent';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * The skills the agent can apply: name, one sentence and what each produces.
 * Read-only; methodology text is never shown and nothing is downloadable.
 */
export function SkillsScreen() {
  const workspaceId = useActiveWorkspaceId() ?? '';
  const query = useQuery({ ...agentQueries.skills(workspaceId), enabled: Boolean(workspaceId) });

  let body;
  if (query.isError)
    body = (
      <ReadError
        error={query.error}
        fallback="Skills could not be loaded."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  else if (!query.data) body = <PageLoading />;
  else body = <SkillGroups skills={query.data.skills} />;

  return (
    <PageShell measure="workflow">
      <Stack gap="section">
        {/* PageShell has no description slot, so the route's intro is the body's first child. */}
        <p className={textRole('body', 'max-w-[72ch]')}>
          Skills are the agent’s available methods. It selects a method when a deliverable needs
          one, or you can choose here or in the composer. Typing / opens that same skill menu.
          Questions can stay simple replies.
        </p>
        {body}
      </Stack>
    </PageShell>
  );
}

function SkillGroups({ skills }: Readonly<{ skills: AgentSkill[] }>) {
  const { kindLabel } = useAgentCatalog();
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of skills) {
    const label = skillGroupLabel(skill.group);
    groups.set(label, [...(groups.get(label) ?? []), skill]);
  }
  return (
    <Stack gap="section">
      {[...groups].map(([group, rows]) => (
        <Stack as="section" key={group} aria-label={group}>
          <EditorialSectionHeader
            title={group}
            description={`${rows.length} ${rows.length === 1 ? 'skill' : 'skills'}`}
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((skill) => (
              <Stack as="li" key={skill.id} className={panelClasses({ pad: 'compact' })}>
                <Stack gap="tight">
                  <h3 className={textRole('itemTitle')}>{skill.label}</h3>
                  <p className={textRole('body')}>{skill.description}</p>
                </Stack>
                <div className="flex flex-wrap items-center justify-between gap-2 self-end">
                  <Badge>Produces {kindLabel(skill.output_kind).toLowerCase()}</Badge>
                  <Button asChild variant="ghost" size="sm">
                    <ProjectLink
                      href={agentHandoffHref({ skillId: skill.id })}
                      aria-label={`Start a chat with ${skill.label}`}
                    >
                      Start a chat
                    </ProjectLink>
                  </Button>
                </div>
              </Stack>
            ))}
          </ul>
        </Stack>
      ))}
    </Stack>
  );
}
