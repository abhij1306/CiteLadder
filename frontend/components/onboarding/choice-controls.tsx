'use client';

/**
 * Selection primitives for onboarding review.
 *
 * Onboarding is a confirmation step, not an authoring step. People will click
 * to accept or reject something we already worked out; they will not compose
 * prose about their own company in a textarea. Every control here is therefore
 * a choice, and free text appears only as a deliberate escape hatch.
 *
 * FlowGroup owns the question hierarchy and separation. This module owns only
 * the answer rows and selection controls.
 */

import { Check, Pencil } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Pressable } from '@/components/ui/pressable';

/**
 * A discovered entity as a ruled row: identity, what it is, and whether we are
 * tracking it.
 *
 * This was a chip, and a wall of chips is what the review step had become —
 * every competitor logo sitting inside its own outlined rectangle, so the page
 * read as two dozen small boxes rather than as a list of companies. The logo is
 * already the design; the row only has to say yes or no about it.
 *
 * The whole row is the toggle, with `aria-pressed` carrying the state, and the
 * visible name is the accessible name. Edit stays a separate explicit control
 * beside it, never a second meaning for clicking the row.
 */
export function EntityRow({
  name,
  meta,
  selected,
  onToggle,
  disabled = false,
  leading,
  onEdit,
  editLabel,
  trailing,
}: Readonly<{
  name: string;
  /** The domain, or whatever else identifies this beyond its name. */
  meta?: string;
  selected: boolean;
  onToggle: () => void;
  /** True when selecting this would exceed the cap. Excluding stays available. */
  disabled?: boolean;
  leading?: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
  trailing?: ReactNode;
}>) {
  // The NAME names the row, not the name plus the domain under it. Letting the
  // row's whole text content become its accessible name meant a voice-control
  // user had to say "Jira atlassian.com" to click Jira, and `aria-pressed`
  // already carries the selected state.
  const nameId = useId();
  return (
    <li className="flow-entity">
      <Pressable
        aria-pressed={selected}
        aria-labelledby={nameId}
        disabled={disabled && !selected}
        onClick={onToggle}
        className="flow-entity-row"
      >
        {leading}
        <span className="flow-entity-identity">
          <span id={nameId} className="flow-entity-name">
            {name}
          </span>
          {meta ? <span className="flow-entity-meta">{meta}</span> : null}
        </span>
        <span className="flow-entity-mark" aria-hidden>
          {selected ? <Check className="size-3.5" /> : null}
        </span>
      </Pressable>
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={editLabel ?? `Edit ${name}`}
          className="size-8 shrink-0"
        >
          <Pencil className="size-3.5" aria-hidden />
        </Button>
      ) : null}
      {trailing}
    </li>
  );
}
