'use client';
import { Download, Folder } from 'lucide-react';
import { crawlerResourceClassSchema } from '@citeladder/contracts/site-health';
import type { useTrafficData } from '@/lib/ai-traffic/use-traffic-data';
import { words } from '@/lib/ai-traffic/vocabulary';
import { TRAFFIC_RANGES, VERIFICATION_OPTIONS } from '@/lib/config/crawl-logs';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
type ControlProps = Readonly<{ model: ReturnType<typeof useTrafficData> }>;
type TrafficControlsProps = ControlProps & Readonly<{ crawlAvailable: boolean }>;
/** Narrow screens give every field the band's full width instead of a ragged wrap. */
const FIELD = 'max-[700px]:w-full';
export function TrafficControls({ model, crawlAvailable }: TrafficControlsProps) {
  const { tab } = model;
  const { range, setRange, verification, setVerification } = model.selection;
  return (
    <>
      <Select
        ariaLabel="Reporting range"
        value={range}
        onValueChange={setRange}
        options={TRAFFIC_RANGES}
        className={FIELD}
      />
      {/* Verification filters crawler requests only. */}
      {crawlAvailable ? (
        <Select
          ariaLabel="Verification"
          value={verification}
          onValueChange={setVerification}
          options={VERIFICATION_OPTIONS}
          className={FIELD}
        />
      ) : null}
      {tab === 'crawlers' ? <CrawlerPurposeControl model={model} /> : null}
      {tab === 'activity' ? <ActivityControls model={model} /> : null}
      {tab === 'overview' ? null : <ScopeControls model={model} />}
      {tab === 'pages' ? <PagesControls model={model} /> : null}
      {tab === 'overview' ? null : (
        <Button
          variant="secondary"
          className={`ms-auto ${FIELD}`}
          pending={model.exporting.isPending}
          onClick={() => model.exporting.mutate()}
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </Button>
      )}
    </>
  );
}
function ScopeControls({ model }: ControlProps) {
  const { folder, setFolder, resource, setResource } = model.selection;
  return (
    <>
      <Input
        size="compact"
        aria-label="Folder"
        placeholder="Folder"
        value={folder ?? ''}
        onChange={(e) => setFolder(e.target.value || null)}
        startContent={<Folder className="size-4" aria-hidden />}
        containerClassName={`w-44 ${FIELD}`}
      />
      <Select
        ariaLabel="Resource class"
        value={resource ?? ''}
        onValueChange={(v) => setResource(v || null)}
        options={[
          { value: '', label: 'All resources' },
          ...crawlerResourceClassSchema.options.map((value) => ({ value, label: words(value) })),
        ]}
        className={FIELD}
      />
    </>
  );
}
function PagesControls({ model }: ControlProps) {
  const { sort, setSort, pattern, setPattern } = model.selection;
  return (
    <>
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
      {pattern ? (
        <Button variant="ghost" onClick={() => setPattern(null)}>
          Clear insight filter
        </Button>
      ) : null}
    </>
  );
}
function CrawlerPurposeControl({ model }: ControlProps) {
  const { purpose, setPurpose } = model.selection;
  return (
    <Select
      ariaLabel="Crawler purpose"
      value={purpose ?? ''}
      onValueChange={(v) => setPurpose(v || null)}
      options={[
        { value: '', label: 'All purposes' },
        ...[...new Set(model.catalog.data?.bots.map((b) => b.purpose) ?? [])].map((value) => ({
          value,
          label: words(value),
        })),
      ]}
      className={FIELD}
    />
  );
}
function ActivityControls({ model }: ControlProps) {
  const { bot, setBot, status, setStatus } = model.selection;
  return (
    <>
      <Select
        ariaLabel="Bot"
        value={bot ?? ''}
        onValueChange={(v) => setBot(v || null)}
        options={[
          { value: '', label: 'All bots' },
          ...(model.catalog.data?.bots.map((b) => ({ value: b.bot_id, label: b.label })) ?? []),
        ]}
        className={FIELD}
      />
      <Input
        size="compact"
        aria-label="Response status"
        placeholder="Status code"
        type="number"
        inputMode="numeric"
        min={100}
        max={599}
        step={1}
        value={status ?? ''}
        onChange={(e) => setStatus(e.target.value || null)}
        className={`w-32 ${FIELD}`}
      />
    </>
  );
}
