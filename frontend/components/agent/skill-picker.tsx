import { Fragment } from 'react';

import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from '@/components/ui/menu';
import { skillGroupLabel } from '@/lib/agent/vocabulary';
import { type AgentSkill } from '@/lib/api/agent';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';

const AUTOMATIC = '';
const INHERIT = '__inherit';

export function skillLabel(skills: AgentSkill[], skillId: string | null): string | null {
  if (!skillId) return null;
  return skills.find((skill) => skill.id === skillId)?.label ?? null;
}

export function useSkillChoice({
  value,
  onChange,
  hasDocument = false,
  inheritedSkillId,
  hasAction = false,
  pinned,
}: Readonly<{
  value: string | null | undefined;
  onChange: (skillId: string | null | undefined) => void;
  hasDocument?: boolean;
  inheritedSkillId?: string | null;
  hasAction?: boolean;
  pinned?: Readonly<{ label: string; onRemove: () => void }>;
}>) {
  const catalog = useAgentCatalog();
  const { skills } = catalog;
  const defaultLabel = defaultLabelFor(skills, {
    pinned,
    inheritedSkillId,
    hasDocument,
    hasAction,
  });
  const picked = value ? (skillLabel(skills, value) ?? '…') : null;
  const isDefault = value === undefined && defaultLabel !== null;
  let chip: Readonly<{ label: string; onRemove: () => void }> | undefined;
  if (picked) chip = { label: `Skill: ${picked}`, onRemove: () => onChange(undefined) };
  else if (isDefault)
    chip = {
      label: `Skill: ${defaultLabel}`,
      onRemove: pinned?.onRemove ?? (() => onChange(null)),
    };
  return {
    skills,
    status: catalog.read.status,
    chip,
    current: picked ?? (isDefault ? defaultLabel : 'Automatic'),
    defaultLabel,
    radioValue: isDefault ? INHERIT : (value ?? AUTOMATIC),
    choose: (next: string) => onChange(selectedValue(next)),
  };
}
export type SkillChoice = ReturnType<typeof useSkillChoice>;

export function SkillsSubmenu({
  choice,
  onSelect,
}: Readonly<{ choice: SkillChoice; onSelect?: () => void }>) {
  return (
    <MenuSub>
      <MenuSubTrigger value={choice.current}>Skills</MenuSubTrigger>
      <MenuSubContent>
        <SkillOptions choice={choice} onSelect={onSelect} />
      </MenuSubContent>
    </MenuSub>
  );
}

export function SkillOptions({
  choice,
  onSelect,
}: Readonly<{ choice: SkillChoice; onSelect?: () => void }>) {
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of choice.skills) {
    const label = skillGroupLabel(skill.group);
    groups.set(label, [...(groups.get(label) ?? []), skill]);
  }
  return (
    <MenuRadioGroup
      value={choice.radioValue}
      onValueChange={(next) => {
        onSelect?.();
        choice.choose(next);
      }}
    >
      {choice.defaultLabel ? (
        <MenuRadioItem value={INHERIT}>{choice.defaultLabel}</MenuRadioItem>
      ) : null}
      <MenuRadioItem value={AUTOMATIC}>Automatic</MenuRadioItem>
      {choice.status === 'pending' ? <MenuItem disabled>Loading skills…</MenuItem> : null}
      {choice.status === 'error' ? <MenuItem disabled>{"Couldn't load skills"}</MenuItem> : null}
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
  );
}

function defaultLabelFor(
  skills: AgentSkill[],
  {
    pinned,
    inheritedSkillId,
    hasDocument,
    hasAction,
  }: Readonly<{
    pinned?: Readonly<{ label: string }>;
    inheritedSkillId?: string | null;
    hasDocument: boolean;
    hasAction: boolean;
  }>,
) {
  if (pinned) return pinned.label;
  const skill = skillLabel(skills, inheritedSkillId ?? null);
  if (skill) return `Continue with ${skill}`;
  if (hasDocument) return "Continue this chat's skill";
  return hasAction ? 'From attached Action' : null;
}
function selectedValue(next: string) {
  if (next === INHERIT) return undefined;
  return next === AUTOMATIC ? null : next;
}
