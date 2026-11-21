import { crawlerResourceClassSchema } from '@citeladder/contracts/site-health';
import { Download, Folder } from '@/lib/icons';
import { trafficStatusCode, type useTrafficData } from '@/lib/ai-traffic/use-traffic-data';
import { words } from '@/lib/ai-traffic/vocabulary';
import type { TrafficFilters } from '@/lib/api/ai-traffic';
import { TRAFFIC_RANGES, VERIFICATION_OPTIONS } from '@/lib/config/crawl-logs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  choiceFilter,
  rangeFilter,
  singleFilter,
  type FilterDefinition,
} from '@/components/ui/all-filters';
import { menuFieldKeys } from '@/components/ui/filter-options';
import { Icon } from '@/components/ui/icon';
type ControlProps = Readonly<{ model: ReturnType<typeof useTrafficData> }>;
type TrafficControlsProps = ControlProps & Readonly<{ crawlAvailable: boolean }>;
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

const NOT_NARROWING: ReadonlySet<string> = new Set(['range', 'sort']);

export function trafficNarrowed(filters: TrafficFilters): boolean {
  return Object.entries(filters).some(
    ([key, value]) => !NOT_NARROWING.has(key) && value !== undefined && value !== null,
  );
}

export function clearTrafficFilters({ selection }: ControlProps['model']) {
  selection.setVerification('default');
  selection.setPurpose(null, 'replace');
  selection.setBot(null, 'replace');
  selection.setStatus(null, 'replace');
  selection.setFolder(null, 'replace');
  selection.setResource(null, 'replace');
  selection.setPattern(null, 'replace');
}

type FilterBuilder = (props: TrafficControlsProps) => FilterDefinition | null;

const FILTER_BUILDERS: readonly FilterBuilder[] = [
  trafficRangeFilter,
  verificationFilter,
  purposeFilter,
  botFilter,
  resourceFilter,
  folderFilter,
  statusFilter,
  insightFilter,
];

export function trafficFilters(props: TrafficControlsProps): FilterDefinition[] {
  return FILTER_BUILDERS.flatMap((build) => build(props) ?? []);
}

function trafficRangeFilter({ model }: TrafficControlsProps) {
  return rangeFilter({
    value: model.selection.range,
    defaultValue: TRAFFIC_RANGES[0].value,
    options: TRAFFIC_RANGES,
    onChange: model.selection.setRange,
  });
}

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
  return singleFilter({
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
  return singleFilter({
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
  return singleFilter({
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
    defaultLabel: 'Any folder',
    reset: () => model.selection.setFolder(null),
    content: <FolderField model={model} />,
  };
}

function statusFilter({ model }: TrafficControlsProps): FilterDefinition | null {
  if (model.tab !== 'activity') return null;
  const code = trafficStatusCode(model.selection.status);
  return {
    kind: 'custom',
    id: 'status',
    label: 'Status code',
    valueLabel: code === undefined ? 'Any status' : String(code),
    isDefault: code === undefined,
    defaultLabel: 'Any status',
    reset: () => model.selection.setStatus(null),
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
    defaultLabel: 'every page',
    reset: () => setPattern(null),
    content: null,
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
