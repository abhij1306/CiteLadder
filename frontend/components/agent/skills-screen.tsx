import { useQuery } from '@tanstack/react-query';

import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/ui/project-link';
import { AppGrid } from '@/components/ui/app-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Inline, Stack } from '@/components/ui/layout';
import { cardClasses } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { skillGroupLabel } from '@/lib/agent/vocabulary';
import { agentQueries, type AgentSkill } from '@/lib/api/agent';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * The skills the agent can apply: name, one sentence and what each produces.
 * Read-only; methodology text is never shown and nothing is downloadable.
 */
export function SkillsScreen() {
  const { workspaceId } = useProjectScope();
  const query = useQuery(agentQueries.skills(workspaceId));

  let body;
  if (query.isError)
    body = (
      <QueryState
        kind="error"
        error={query.error}
        fallback="Skills could not be loaded."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  else if (!query.data) body = <QueryState kind="loading" />;
  else body = <SkillGroups skills={query.data.skills} />;

  return (
    <ListScreen narrow>
      <Stack gap="section">
        {/* The template has no description slot, so the route's intro is the body's first child. */}
        <p className={textRole('body')}>
          The agent picks a skill when a task needs one, or choose one here or type / in the
          composer.
        </p>
        {body}
      </Stack>
    </ListScreen>
  );
}

/**
 * What a skill produces, by the catalog's own name for it ("LinkedIn post",
 * "FAQ"), never lowercased. An output kind the catalog does not name shows
 * no badge rather than a placeholder.
 */
function OutputBadge({ label }: Readonly<{ label: string | undefined }>) {
  return label ? <Badge>{`Output: ${label}`}</Badge> : <span />;
}

function SkillGroups({ skills }: Readonly<{ skills: AgentSkill[] }>) {
  const { outputKind } = useAgentCatalog();
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
          <AppGrid as="ul" layout="halves">
            {rows.map((skill) => (
              <Stack as="li" key={skill.id} className={cardClasses()}>
                <Stack gap="tight">
                  <h3 className={textRole('itemTitle')}>{skill.label}</h3>
                  <p className={textRole('body')}>{skill.description}</p>
                </Stack>
                <Inline className="flex-wrap justify-between self-end">
                  <OutputBadge label={outputKind(skill.output_kind)?.label} />
                  <Button asChild variant="ghost">
                    <ProjectLink
                      href={agentHandoffHref({ skillId: skill.id })}
                      aria-label={`Start a chat with ${skill.label}`}
                    >
                      Start a chat
                    </ProjectLink>
                  </Button>
                </Inline>
              </Stack>
            ))}
          </AppGrid>
        </Stack>
      ))}
    </Stack>
  );
}
