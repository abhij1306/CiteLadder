import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { skillGroupLabel } from '@/lib/agent/vocabulary';
import { type AgentSkill } from '@/lib/api/agent';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';

const AUTOMATIC = '';
const INHERIT = '__inherit';

/** The skills, shared by the picker and the message skill labels. */
export function useSkillCatalog(): AgentSkill[] {
  return useAgentCatalog().skills;
}

export function skillLabel(skills: AgentSkill[], skillId: string | null): string | null {
  if (!skillId) return null;
  return skills.find((skill) => skill.id === skillId)?.label ?? null;
}

/**
 * Choose the skill for the next turn, or leave it automatic. Any skill can
 * write in any chat; a different kind of deliverable becomes another document.
 */
export function SkillPicker({
  value,
  onChange,
  hasDocument = false,
  inheritedSkillId,
  hasAction = false,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onCloseAutoFocus,
}: Readonly<{
  value: string | null | undefined;
  onChange: (skillId: string | null | undefined) => void;
  /** The chat already holds a document, so an unpicked skill continues its workflow. */
  hasDocument?: boolean;
  inheritedSkillId?: string | null;
  hasAction?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}>) {
  const skills = useSkillCatalog();
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of skills) {
    const label = skillGroupLabel(skill.group);
    groups.set(label, [...(groups.get(label) ?? []), skill]);
  }
  const inherited = skillLabel(skills, inheritedSkillId ?? null);
  const defaultLabel = inheritedLabel(inherited, hasDocument, hasAction);
  const current =
    value === null ? 'Automatic' : (skillLabel(skills, value ?? null) ?? defaultLabel);
  return (
    <Menu open={disabled ? false : open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={`Skill: ${current}`}
          className="max-w-full min-w-0"
        >
          <span className="min-w-0 truncate">Skill: {current}</span>
          <Icon icon={ChevronDown} />
        </Button>
      </MenuTrigger>
      <MenuContent align="start" onCloseAutoFocus={onCloseAutoFocus}>
        <MenuRadioGroup
          value={
            value === undefined && defaultLabel !== 'Automatic' ? INHERIT : (value ?? AUTOMATIC)
          }
          onValueChange={(next) => {
            onSelect?.();
            onChange(selectedValue(next));
          }}
        >
          {defaultLabel !== 'Automatic' ? (
            <MenuRadioItem value={INHERIT}>{defaultLabel}</MenuRadioItem>
          ) : null}
          <MenuRadioItem value={AUTOMATIC}>Automatic</MenuRadioItem>
          {[...groups].map(([group, rows]) => (
            <Fragment key={group}>
              <MenuSeparator />
              <MenuLabel>{group}</MenuLabel>
              {rows.map((skill) => (
                <MenuRadioItem key={skill.id} value={skill.id}>
                  {skill.label}
                </MenuRadioItem>
              ))}
            </Fragment>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
function inheritedLabel(skill: string | null, hasDocument: boolean, hasAction: boolean) {
  if (skill) return `Continue with ${skill}`;
  if (hasDocument) return 'Continue chat workflow';
  return hasAction ? 'From attached Action' : 'Automatic';
}
function selectedValue(next: string) {
  if (next === INHERIT) return undefined;
  return next === AUTOMATIC ? null : next;
}
