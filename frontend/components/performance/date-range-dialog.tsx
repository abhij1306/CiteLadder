'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import {
  COMPARE_OPTIONS,
  DIALOG_RANGE_OPTIONS,
  type RangeSelection,
} from '@/lib/performance/performance';

/**
 * The Search-Console-shaped date dialog: a **Filter** tab that chooses the
 * range being viewed, and a **Compare** tab that chooses what it is measured
 * against.
 *
 * The dialog edits a DRAFT and only lifts it on Apply, so a half-typed date
 * never triggers a projection request. Year over year is disabled — with an
 * explicit reason — until the project has imported more than a year of
 * history: a first connect imports 365 days, so the comparison is genuinely
 * unavailable rather than zero, and offering it would render an empty window
 * that reads like a collapse in traffic.
 */

/**
 * A real Gregorian day in ISO form.
 *
 * The shape test alone accepts "2026-02-31", which `Date.UTC` silently rolls
 * forward to March 3 — Apply would then request a window the user never
 * chose. The round trip is what rejects it.
 */
function isoDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

/** Whether both ends are real days, ordered, and inside imported coverage. */
function isUsableWindow(
  from: string,
  to: string,
  coverage: { earliest: string | null; latest: string | null },
): boolean {
  if (!isoDay(from) || !isoDay(to) || to < from) return false;
  // ISO days compare correctly as strings, so no parsing is needed here.
  if (coverage.earliest && from < coverage.earliest) return false;
  if (coverage.latest && to > coverage.latest) return false;
  return true;
}

/** Whether a draft is internally consistent enough to request. */
function isApplicable(
  draft: RangeSelection,
  coverage: { earliest: string | null; latest: string | null },
): boolean {
  if (draft.range === 'custom' && !isUsableWindow(draft.from, draft.to, coverage)) {
    return false;
  }
  if (draft.compare === 'custom' && !isUsableWindow(draft.compareFrom, draft.compareTo, coverage)) {
    return false;
  }
  return true;
}

function DateRangeFields({
  legend,
  from,
  to,
  onFrom,
  onTo,
  min,
  max,
}: Readonly<{
  legend: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  min?: string;
  max?: string;
}>) {
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Start date" hint="YYYY-MM-DD">
          {(props) => (
            <DateField
              {...props}
              ariaLabel="Start date"
              value={from}
              min={min}
              max={max}
              onChange={onFrom}
            />
          )}
        </Field>
        <span className="text-muted pb-2">–</span>
        <Field label="End date" hint="YYYY-MM-DD">
          {(props) => (
            <DateField
              {...props}
              ariaLabel="End date"
              value={to}
              min={min}
              max={max}
              onChange={onTo}
            />
          )}
        </Field>
      </div>
    </fieldset>
  );
}

export function DateRangeDialog({
  open,
  onOpenChange,
  selection,
  onApply,
  coverage,
  yearOverYearAvailable,
  initialTab = 'filter',
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: RangeSelection;
  onApply: (selection: RangeSelection) => void;
  /** Imported evidence extent, used to bound the pickers honestly. */
  coverage: { earliest: string | null; latest: string | null };
  yearOverYearAvailable: boolean;
  /** Which tab the dialog opens on — Compare when opened from that button. */
  initialTab?: 'filter' | 'compare';
}>) {
  const [draft, setDraft] = useState(selection);
  const [tab, setTab] = useState<'filter' | 'compare'>(initialTab);
  // Re-seed on the CLOSED -> OPEN transition so a cancelled edit is truly
  // discarded. Tracked as state and adjusted during render (React's own
  // pattern for derived-from-props state) rather than in an effect, which
  // would render the stale draft once before correcting it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const isDialogRange = DIALOG_RANGE_OPTIONS.some((o) => o.value === selection.range);
      setDraft({
        ...selection,
        range: isDialogRange ? selection.range : 'last_synced',
      });
      // Opening from Compare lands on Compare; opening from a range lands on
      // Filter. The tab a previous visit ended on is not a preference.
      setTab(initialTab);
    }
  }

  const patch = (next: Partial<RangeSelection>) => setDraft((current) => ({ ...current, ...next }));

  const compareOptions = COMPARE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.value === 'year_over_year' && !yearOverYearAvailable,
    description:
      option.value === 'year_over_year' && !yearOverYearAvailable
        ? 'Needs more than a year of imported history'
        : undefined,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Date range"
      description={
        coverage.earliest && coverage.latest
          ? `Imported history covers ${coverage.earliest} to ${coverage.latest}.`
          : 'No imported history yet.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!isApplicable(draft, coverage)}
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </div>
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'filter', label: 'Filter' },
          { value: 'compare', label: 'Compare' },
        ]}
        ariaLabel="Date range mode"
        rootClassName="grid gap-4"
      >
        <TabPanel value="filter" className="grid gap-3">
          <RadioGroup
            ariaLabel="Date range"
            value={draft.range}
            onValueChange={(range) => patch({ range })}
            options={DIALOG_RANGE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          {/* Always visible: the dates are the point of the Custom option, so
              hiding them behind selecting the radio first costs a click for
              no benefit. Typing a date IS choosing Custom, so the inputs
              select the radio themselves. */}
          <DateRangeFields
            legend="Custom date range"
            from={draft.from}
            to={draft.to}
            min={coverage.earliest ?? undefined}
            max={coverage.latest ?? undefined}
            onFrom={(from) => patch({ from, range: 'custom' })}
            onTo={(to) => patch({ to, range: 'custom' })}
          />
        </TabPanel>
        <TabPanel value="compare" className="grid gap-3">
          <RadioGroup
            ariaLabel="Comparison"
            value={draft.compare}
            onValueChange={(compare) => patch({ compare })}
            options={compareOptions}
          />
          <DateRangeFields
            legend="Custom comparison range"
            from={draft.compareFrom}
            to={draft.compareTo}
            min={coverage.earliest ?? undefined}
            max={coverage.latest ?? undefined}
            onFrom={(compareFrom) => patch({ compareFrom, compare: 'custom' })}
            onTo={(compareTo) => patch({ compareTo, compare: 'custom' })}
          />
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}
