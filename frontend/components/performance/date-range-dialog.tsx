import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { X } from '@/lib/icons';
import { formatWindowDate } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { Inline, Stack } from '@/components/ui/layout';
import { RadioGroup } from '@/components/ui/radio-group';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import {
  COMPARE_OPTIONS,
  DIALOG_RANGE_OPTIONS,
  type RangeSelection,
} from '@/lib/performance/performance';

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

function isUsableWindow(
  from: string,
  to: string,
  coverage: { earliest: string | null; latest: string | null },
): boolean {
  if (!isoDay(from) || !isoDay(to) || to < from) return false;
  if (coverage.earliest && from < coverage.earliest) return false;
  if (coverage.latest && to > coverage.latest) return false;
  return true;
}

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
  onActivate,
  min,
  max,
}: Readonly<{
  legend: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onActivate: () => void;
  min?: string;
  max?: string;
}>) {
  return (
    <Stack as="fieldset" gap="compact" onFocus={onActivate}>
      <legend className="sr-only">{legend}</legend>
      <Inline gap="compact" className="flex-wrap">
        <Field label="Start date">
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
        <span className="text-ink-2">–</span>
        <Field label="End date">
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
      </Inline>
    </Stack>
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
  coverage: { earliest: string | null; latest: string | null };
  yearOverYearAvailable: boolean;
  initialTab?: 'filter' | 'compare';
}>) {
  const [draft, setDraft] = useState(selection);
  const [tab, setTab] = useState<'filter' | 'compare'>(initialTab);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const isDialogRange = DIALOG_RANGE_OPTIONS.some((o) => o.value === selection.range);
      setDraft({
        ...selection,
        range: isDialogRange ? selection.range : 'last_synced',
      });
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
      width="wide"
      description={
        coverage.earliest && coverage.latest
          ? `History: ${formatWindowDate(coverage.earliest)} to ${formatWindowDate(coverage.latest)}`
          : undefined
      }
      footer={
        <>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            <Icon icon={X} />
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!isApplicable(draft, coverage)}
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </>
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
        spaced
      >
        <TabPanel value="filter">
          <Stack gap="compact">
            <RadioGroup
              ariaLabel="Date range"
              value={draft.range}
              onValueChange={(range) => patch({ range })}
              options={DIALOG_RANGE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <DateRangeFields
              legend="Custom date range"
              from={draft.from}
              to={draft.to}
              min={coverage.earliest ?? undefined}
              max={coverage.latest ?? undefined}
              onFrom={(from) => patch({ from, range: 'custom' })}
              onTo={(to) => patch({ to, range: 'custom' })}
              onActivate={() => patch({ range: 'custom' })}
            />
          </Stack>
        </TabPanel>
        <TabPanel value="compare">
          <Stack gap="compact">
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
              onActivate={() => patch({ compare: 'custom' })}
            />
          </Stack>
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}
