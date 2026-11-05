'use client';
import { Fragment } from 'react';
import { Download, Folder } from 'lucide-react';
import { crawlerResourceClassSchema } from '@citeladder/contracts/site-health';
import type { useTrafficData } from '@/lib/ai-traffic/use-traffic-data';
import { words } from '@/lib/ai-traffic/vocabulary';
import { TRAFFIC_RANGES, VERIFICATION_OPTIONS } from '@/lib/config/crawl-logs';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterField, FilterTrigger } from '@/components/ui/filter-bar';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Icon } from '@/components/ui/icon';
type ControlProps = Readonly<{ model: ReturnType<typeof useTrafficData> }>;
type TrafficControlsProps = ControlProps & Readonly<{ crawlAvailable: boolean }>;
/** Narrow screens give every field the band's full width instead of a ragged wrap. */
const FIELD = 'w-full desktop:w-auto';
/**
 * The control band: the range, one Filter menu holding every picked narrowing
 * (verification, resource class, crawler purpose, bot, an insight's filter),
 * then the typed fields and the Pages sort. Every tab draws the same short
 * row, so switching tabs never wraps the band or moves the content below it
 * (2026-11-03 app review); export is a route action in the identity band.
 */
export function TrafficControls({ model, crawlAvailable }: TrafficControlsProps) {
  const { tab } = model;
  const { range, setRange } = model.selection;
  return (
    <>
      <Select
        ariaLabel="Reporting range"
        value={range}
        onValueChange={setRange}
        options={TRAFFIC_RANGES}
        className={FIELD}
      />
      <TrafficFilterMenu model={model} crawlAvailable={crawlAvailable} />
      {tab === 'overview' ? null : <FolderField model={model} />}
      {tab === 'activity' ? <StatusField model={model} /> : null}
      {tab === 'pages' ? <PagesSort model={model} /> : null}
    </>
  );
}

/** Export for the tabs that list rows, as a route action. */
export function TrafficExport({ model }: ControlProps) {
  return (
    <Button
      variant="secondary"
      pending={model.exporting.isPending}
      onClick={() => model.exporting.mutate()}
    >
      <Icon icon={Download} />
      Export CSV
    </Button>
  );
}

type MenuGroup = Readonly<{
  key: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Moved off its unfiltered value. */
  active: boolean;
}>;

function menuGroups({ model, crawlAvailable }: TrafficControlsProps): MenuGroup[] {
  const { tab, selection } = model;
  const groups: MenuGroup[] = [];
  // Verification filters crawler requests only.
  if (crawlAvailable)
    groups.push({
      key: 'verification',
      label: 'Verification',
      value: selection.verification,
      options: VERIFICATION_OPTIONS,
      onChange: (value) => {
        const next = VERIFICATION_OPTIONS.find((option) => option.value === value);
        if (next) selection.setVerification(next.value);
      },
      active: selection.verification !== 'default',
    });
  if (tab === 'crawlers')
    groups.push({
      key: 'purpose',
      label: 'Crawler purpose',
      value: selection.purpose ?? '',
      options: [
        { value: '', label: 'All purposes' },
        ...[...new Set(model.catalog.data?.bots.map((b) => b.purpose) ?? [])].map((value) => ({
          value,
          label: words(value),
        })),
      ],
      onChange: (value) => selection.setPurpose(value || null),
      active: Boolean(selection.purpose),
    });
  if (tab === 'activity')
    groups.push({
      key: 'bot',
      label: 'Bot',
      value: selection.bot ?? '',
      options: [
        { value: '', label: 'All bots' },
        ...(model.catalog.data?.bots.map((b) => ({ value: b.bot_id, label: b.label })) ?? []),
      ],
      onChange: (value) => selection.setBot(value || null),
      active: Boolean(selection.bot),
    });
  if (tab !== 'overview')
    groups.push({
      key: 'resource',
      label: 'Resource class',
      value: selection.resource ?? '',
      options: [
        { value: '', label: 'All resources' },
        ...crawlerResourceClassSchema.options.map((value) => ({ value, label: words(value) })),
      ],
      onChange: (value) => selection.setResource(value || null),
      active: Boolean(selection.resource),
    });
  return groups;
}

function TrafficFilterMenu(props: TrafficControlsProps) {
  const groups = menuGroups(props);
  const { pattern, setPattern } = props.model.selection;
  const insight = props.model.tab === 'pages' && Boolean(pattern);
  if (groups.length === 0 && !insight) return null;
  const count = groups.filter((group) => group.active).length + (insight ? 1 : 0);
  return (
    <Menu>
      <MenuTrigger asChild>
        <FilterTrigger label="Filter" count={count} />
      </MenuTrigger>
      <MenuContent align="start">
        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 ? <MenuSeparator /> : null}
            <MenuLabel>{group.label}</MenuLabel>
            <MenuRadioGroup value={group.value}>
              {group.options.map((option) => (
                <MenuRadioItem
                  key={option.value || 'all'}
                  value={option.value}
                  onSelect={() => group.onChange(option.value)}
                >
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </Fragment>
        ))}
        {insight ? (
          <>
            {groups.length ? <MenuSeparator /> : null}
            <MenuItem onSelect={() => setPattern(null)}>Clear insight filter</MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

function FolderField({ model }: ControlProps) {
  const { folder, setFolder } = model.selection;
  return (
    <FilterField>
      <Input
        aria-label="Folder"
        placeholder="Folder"
        value={folder ?? ''}
        onChange={(e) => setFolder(e.target.value || null)}
        startContent={<Icon icon={Folder} />}
      />
    </FilterField>
  );
}

function PagesSort({ model }: ControlProps) {
  const { sort, setSort } = model.selection;
  return (
    <Select
      ariaLabel="Sort pages"
      value={sort}
      onValueChange={setSort}
      options={[
        { value: 'requests_desc', label: 'Requests' },
        { value: 'sessions_desc', label: 'AI referral sessions' },
        { value: 'key_events_desc', label: 'Key events' },
        { value: 'citations_desc', label: 'Tracked citations' },
        { value: 'url_asc', label: 'URL' },
      ]}
      className={FIELD}
    />
  );
}

function StatusField({ model }: ControlProps) {
  const { status, setStatus } = model.selection;
  return (
    <FilterField>
      <Input
        aria-label="Response status"
        placeholder="Status code"
        type="number"
        inputMode="numeric"
        min={100}
        max={599}
        step={1}
        value={status ?? ''}
        onChange={(e) => setStatus(e.target.value || null)}
      />
    </FilterField>
  );
}
