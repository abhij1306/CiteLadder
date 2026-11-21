import type { ReactNode } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { Switch } from '@/components/ui/switch';
import { textRole } from '@/components/ui/typography';
import type { EntityMatching } from '@citeladder/contracts';

export type MentionRuleDraft = {
  mode: EntityMatching['mode'];
  contextTerms: string;
  exclusionPhrases: string;
  open: boolean;
  touched: boolean;
};

export function mentionRuleDraft(matching: EntityMatching | undefined): MentionRuleDraft {
  return {
    mode: matching?.mode ?? 'always',
    contextTerms: (matching?.context_terms ?? []).join(', '),
    exclusionPhrases: (matching?.exclusion_phrases ?? []).join(', '),
    open: (matching?.common_word ?? false) || matching?.mode === 'context_required',
    touched: false,
  };
}

export function MentionRuleFields({
  name,
  rule,
  onChange,
}: Readonly<{
  name: string;
  rule: MentionRuleDraft;
  onChange: (rule: MentionRuleDraft) => void;
}>) {
  const update = (patch: Partial<MentionRuleDraft>) =>
    onChange({ ...rule, ...patch, touched: true });
  const fields: ReactNode = (
    <Stack
      as="fieldset"
      gap="compact"
      aria-label={`Mention rule for ${name || 'this name'}`}
      className="min-w-0"
    >
      <Inline gap="compact">
        <Switch
          checked={rule.mode === 'context_required'}
          onCheckedChange={(checked) => update({ mode: checked ? 'context_required' : 'always' })}
          label={`${name || 'This name'} needs context to count as a mention`}
        />
        <span aria-hidden className={textRole('body', 'text-ink-2')}>
          Needs context to count as a mention
        </span>
      </Inline>
      {rule.mode === 'context_required' ? (
        <Field label="Context words" hint="Comma separated">
          {(props) => (
            <Input
              {...props}
              value={rule.contextTerms}
              onChange={(event) => update({ contextTerms: event.target.value })}
              placeholder="store, shopping, brand"
            />
          )}
        </Field>
      ) : null}
      <Field label="Never counts inside" hint="Comma separated">
        {(props) => (
          <Input
            {...props}
            value={rule.exclusionPhrases}
            onChange={(event) => update({ exclusionPhrases: event.target.value })}
            placeholder="target audience, target market"
          />
        )}
      </Field>
    </Stack>
  );
  if (rule.open) return fields;
  return <Disclosure title="Mention rule">{fields}</Disclosure>;
}
