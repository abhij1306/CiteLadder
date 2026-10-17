'use client';

import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownContent,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
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
 * Choose the skill for the next turn, or leave it automatic. A chat with an
 * output offers only skills that produce the same kind of output; a different
 * kind of deliverable belongs in a new chat.
 */
export function SkillPicker({
  value,
  onChange,
  outputKind,
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
  outputKind?: string | null;
  inheritedSkillId?: string | null;
  hasAction?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}>) {
  const skills = useSkillCatalog().filter(
    (skill) => !outputKind || skill.output_kind === outputKind,
  );
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of skills) {
    const label = skillGroupLabel(skill.group);
    groups.set(label, [...(groups.get(label) ?? []), skill]);
  }
  const inherited = skillLabel(skills, inheritedSkillId ?? null);
  const defaultLabel = inheritedLabel(inherited, outputKind, hasAction);
  const current =
    value === null ? 'Automatic' : (skillLabel(skills, value ?? null) ?? defaultLabel);
  return (
    <Dropdown open={disabled ? false : open} onOpenChange={onOpenChange}>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} aria-label={`Skill: ${current}`}>
          Skill: {current}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownRadioGroup
          value={
            value === undefined && defaultLabel !== 'Automatic' ? INHERIT : (value ?? AUTOMATIC)
          }
          onValueChange={(next) => {
            onSelect?.();
            onChange(selectedValue(next));
          }}
        >
          {defaultLabel !== 'Automatic' ? (
            <DropdownRadioItem value={INHERIT}>{defaultLabel}</DropdownRadioItem>
          ) : null}
          <DropdownRadioItem value={AUTOMATIC}>Automatic</DropdownRadioItem>
          {[...groups].map(([group, rows]) => (
            <Fragment key={group}>
              <DropdownSeparator />
              <DropdownLabel>{group}</DropdownLabel>
              {rows.map((skill) => (
                <DropdownRadioItem key={skill.id} value={skill.id}>
                  {skill.label}
                </DropdownRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}
function inheritedLabel(
  skill: string | null,
  outputKind: string | null | undefined,
  hasAction: boolean,
) {
  if (skill) return `Continue with ${skill}`;
  if (outputKind) return 'Continue chat workflow';
  return hasAction ? 'From attached Action' : 'Automatic';
}
function selectedValue(next: string) {
  if (next === INHERIT) return undefined;
  return next === AUTOMATIC ? null : next;
}
