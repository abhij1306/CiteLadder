import { Download, Folder } from 'lucide-react';
import { crawlerResourceClassSchema } from '@citeladder/contracts/site-health';
import { trafficStatusCode, type useTrafficData } from '@/lib/ai-traffic/use-traffic-data';
import { words } from '@/lib/ai-traffic/vocabulary';
import { TRAFFIC_RANGES, VERIFICATION_OPTIONS } from '@/lib/config/crawl-logs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { choiceFilter, menuFieldKeys, type FilterDefinition } from '@/components/ui/all-filters';
import { MenuItem } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icon';
type ControlProps = Readonly<{ model: ReturnType<typeof useTrafficData> }>;
type TrafficControlsProps = ControlProps & Readonly<{ crawlAvailable: boolean }>;
/** Export for the tabs that list rows, in the page header's actions. */
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

/** One filter of All filters, or none where the tab does not offer it. */
type FilterBuilder = (props: TrafficControlsProps) => FilterDefinition | null;

/** In menu order. */
const FILTER_BUILDERS: readonly FilterBuilder[] = [
  rangeFilter,
  verificationFilter,
  purposeFilter,
  botFilter,
  resourceFilter,
  folderFilter,
  statusFilter,
  insightFilter,
];

/**
 * Every narrowing the tab offers, for its control row's All filters: the
 * reporting range, verification, resource class, crawler purpose, bot, the
 * typed folder and status code, and an insight's filter.
 */
export function trafficFilters(props: TrafficControlsProps): FilterDefinition[] {
  return FILTER_BUILDERS.flatMap((build) => build(props) ?? []);
}

/** A choice filter whose unset value is `null` in the URL and "All …" in the menu. */
function optionalChoice({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  allLabel: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}>): FilterDefinition {
  return choiceFilter({
    id,
    label,
    value: value ?? '',
    defaultValue: '',
    groups: [{ options: [{ value: '', label: allLabel }, ...options] }],
    onChange: (picked) => onChange(picked || null),
  });
}

/** The reporting window every tab reads. */
function rangeFilter({ model }: TrafficControlsProps) {
  return choiceFilter({
    id: 'range',
    label: 'Reporting range',
    value: model.selection.range,
    defaultValue: TRAFFIC_RANGES[0].value,
    groups: [{ options: TRAFFIC_RANGES }],
    onChange: model.selection.setRange,
  });
}

// Verification filters crawler requests only.
function verificationFilter({ model, crawlAvailable }: TrafficControlsProps) {
  if (!crawlAvailable) return null;
  return choiceFilter({
    id: 'verification',
    label: 'Verification',
    value: model.selection.verification,
    defaultValue: 'default',
    groups: [{ options: VERIFICATION_OPTIONS }],
    onChange: model.selection.setVerification,
  });
}

function purposeFilter({ model }: TrafficControlsProps) {
  if (model.tab !== 'crawlers') return null;
  const purposes = new Set(model.catalog.data?.bots.map((bot) => bot.purpose));
  return optionalChoice({
    id: 'purpose',
    label: 'Crawler purpose',
    allLabel: 'All purposes',
    value: model.selection.purpose,
    options: [...purposes].map((value) => ({ value, label: words(value) })),
    onChange: model.selection.setPurpose,
  });
}

function botFilter({ model }: TrafficControlsProps) {
  if (model.tab !== 'activity') return null;
  return optionalChoice({
    id: 'bot',
    label: 'Bot',
    allLabel: 'All bots',
    value: model.selection.bot,
    options: model.catalog.data?.bots.map((bot) => ({ value: bot.bot_id, label: bot.label })) ?? [],
    onChange: model.selection.setBot,
  });
}

function resourceFilter({ model }: TrafficControlsProps) {
  if (model.tab === 'overview') return null;
  return optionalChoice({
    id: 'resource',
    label: 'Resource class',
    allLabel: 'All resources',
    value: model.selection.resource,
    options: crawlerResourceClassSchema.options.map((value) => ({ value, label: words(value) })),
    onChange: model.selection.setResource,
  });
}

function folderFilter({ model }: TrafficControlsProps): FilterDefinition | null {
  if (model.tab === 'overview') return null;
  const { folder } = model.selection;
  return {
    kind: 'custom',
    id: 'folder',
    label: 'Folder',
    valueLabel: folder || 'Any folder',
    isDefault: !folder,
    content: <FolderField model={model} />,
  };
}

function statusFilter({ model }: TrafficControlsProps): FilterDefinition | null {
  if (model.tab !== 'activity') return null;
  // A partly typed code ("40") narrows nothing yet, so it is neither shown nor counted.
  const code = trafficStatusCode(model.selection.status);
  return {
    kind: 'custom',
    id: 'status',
    label: 'Status code',
    valueLabel: code === undefined ? 'Any status' : String(code),
    isDefault: code === undefined,
    content: <StatusField model={model} />,
  };
}

function insightFilter({ model }: TrafficControlsProps): FilterDefinition | null {
  const { pattern, setPattern } = model.selection;
  if (model.tab !== 'pages' || !pattern) return null;
  return {
    kind: 'custom',
    id: 'insight',
    label: 'Insight',
    valueLabel: 'Filtered',
    isDefault: false,
    content: <MenuItem onSelect={() => setPattern(null)}>Clear insight filter</MenuItem>,
  };
}

function FolderField({ model }: ControlProps) {
  const { folder, setFolder } = model.selection;
  return (
    <Input
      aria-label="Folder"
      placeholder="Folder"
      value={folder ?? ''}
      onChange={(e) => setFolder(e.target.value || null)}
      onKeyDown={menuFieldKeys}
      startContent={<Icon icon={Folder} />}
    />
  );
}

function StatusField({ model }: ControlProps) {
  const { status, setStatus } = model.selection;
  return (
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
      onKeyDown={menuFieldKeys}
    />
  );
}
