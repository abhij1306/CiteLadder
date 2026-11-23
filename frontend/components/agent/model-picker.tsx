import { useState } from 'react';

import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/components/ui/menu';
import { Lock } from '@/lib/icons';
import type { AgentChatDetail } from '@/lib/api/agent';
import type { AgentReasoningEffort } from '@citeladder/contracts/agent';

const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly Readonly<{ value: AgentReasoningEffort; label: string }>[];

export type ModelPickerState = Readonly<{
  options: readonly Readonly<{ id: string; label: string }>[];
  model: string | undefined;
  effort: AgentReasoningEffort | undefined;
  locked: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: AgentReasoningEffort) => void;
}>;

export type ModelRequest = ReturnType<typeof useModelPicker>['request'];

export function useModelPicker(chat?: AgentChatDetail['model']) {
  const { models } = useAgentCatalog();
  const [model, setModel] = useState<string>();
  const [effort, setEffort] = useState<AgentReasoningEffort>();
  const picker: ModelPickerState = {
    options: models?.options ?? [],
    model: model ?? chat?.id ?? models?.default_model,
    effort: effort ?? chat?.reasoning_effort ?? models?.default_reasoning_effort,
    locked: chat?.locked ?? false,
    onModel: setModel,
    onEffort: setEffort,
  };
  return { picker, request: { model, reasoning_effort: effort } };
}

export function ModelPicker({
  state,
  disabled,
}: Readonly<{ state: ModelPickerState; disabled: boolean }>) {
  const modelLabel =
    state.options.find((option) => option.id === state.model)?.label ?? state.model;
  return (
    <>
      <ChoiceMenu
        label="Model"
        value={state.model}
        shown={modelLabel}
        options={state.options.map(({ id, label }) => ({ value: id, label }))}
        onSelect={state.onModel}
        disabled={disabled}
        locked={state.locked}
      />
      <ChoiceMenu
        label="Effort"
        value={state.effort}
        shown={EFFORTS.find((option) => option.value === state.effort)?.label}
        options={EFFORTS}
        onSelect={state.onEffort}
        disabled={disabled}
        locked={false}
      />
    </>
  );
}

function ChoiceMenu<Value extends string>({
  label,
  value,
  shown,
  options,
  onSelect,
  disabled,
  locked,
}: Readonly<{
  label: string;
  value: Value | undefined;
  shown: string | undefined;
  options: readonly Readonly<{ value: Value; label: string }>[];
  onSelect: (value: Value) => void;
  disabled: boolean;
  locked: boolean;
}>) {
  if (locked)
    return (
      <Button
        variant="quiet"
        aria-label={`${label}: ${shown ?? ''}, set for this chat`}
        aria-disabled
      >
        {shown ?? label}
        <Icon icon={Lock} className="opacity-80" />
      </Button>
    );
  const name = `${label}: ${shown ?? ''}`;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="quiet" aria-label={name} disabled={disabled || options.length === 0}>
          {shown ?? label}
        </Button>
      </MenuTrigger>
      <MenuContent align="start" side="top">
        <MenuRadioGroup value={value ?? ''}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={() => onSelect(option.value)}
            >
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
