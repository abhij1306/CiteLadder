'use client';

import type { ReactNode } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { textRole } from '@/components/ui/typography';
import type { EntityMatching } from '@/lib/api/types';

/** An editable mention rule; `touched` rules are the only ones saved. */
export type MentionRuleDraft = {
  mode: EntityMatching['mode'];
  contextTerms: string;
  exclusionPhrases: string;
  /**
   * Shown open (an ordinary-word name, or one already needing context) rather
   * than behind a disclosure; fixed while the panel is open.
   */
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

/**
 * When a brand or competitor name counts as a mention. A name that is an
 * ordinary word ("Target", "Notion") shows its rule straight away; any other
 * name keeps it behind a disclosure, since every occurrence counts by default.
 */
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
    <fieldset aria-label={`Mention rule for ${name || 'this name'}`} className="grid min-w-0 gap-3">
      <div className="flex items-center gap-3">
        <Switch
          checked={rule.mode === 'context_required'}
          onCheckedChange={(checked) => update({ mode: checked ? 'context_required' : 'always' })}
          label={`${name || 'This name'} needs context to count as a mention`}
        />
        <span aria-hidden className={textRole('body')}>
          Needs context to count as a mention
        </span>
      </div>
      {rule.mode === 'context_required' ? (
        <Field
          label="Context words"
          hint="Comma separated. A mention counts only when one of these appears near the name."
        >
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
      <Field
        label="Never counts inside"
        hint="Comma separated. Phrases where the name is an ordinary word."
      >
        {(props) => (
          <Input
            {...props}
            value={rule.exclusionPhrases}
            onChange={(event) => update({ exclusionPhrases: event.target.value })}
            placeholder="target audience, target market"
          />
        )}
      </Field>
    </fieldset>
  );
  // Decided once per draft, so toggling the switch never remounts the fields.
  if (rule.open) return fields;
  return <Disclosure title="Mention rule">{fields}</Disclosure>;
}
