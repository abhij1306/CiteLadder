import { ArrowRight, Download, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProjectLink } from '@/components/ui/project-link';
import { LaunchAuditButton } from '@/components/runs/launch-audit-button';

import { Badge } from '@/components/ui/badge';
import { TagGroup } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ReorderList } from '@/components/ui/reorder-list';
import { StatRow, type StatSegment } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MetricValue } from '@/components/ui/metric-value';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { availabilityLabel, pluralCount } from '@/lib/format';
import type { CommandCenter, Project } from '@citeladder/contracts';
import { DisplayTime } from '@/components/ui/display-time';

import { ProjectControls } from './dashboard-controls';
import {
  actionItem,
  MovementChart,
  percentFigure,
  rankFigure,
  VS_PREVIOUS_RUN,
} from './dashboard-primitives';
import { ClampText } from '@/components/ui/table';

/**
 * One line over the Overview: the site, and the run it was last tracked in
 * with its engines. The sidebar's project switcher already names the project,
 * so the line does not repeat the name or the logo.
 */
/** The site as a link target: an http(s) URL, or null when it is anything else. */
function websiteHref(website: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`;
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

export function ProjectMeta({ data }: Readonly<{ data: CommandCenter }>) {
  const website = data.project.website_url;
  const measurement = data.measurement;
  if (!website && !measurement) return null;
  const href = website ? websiteHref(website) : null;
  const shown = website?.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return (
    <Inline as="p" gap="meta" className={textRole('caption')}>
      {href ? (
        <TextLink variant="external" text="caption" tone="muted" href={href} className="min-w-0">
          <span className="truncate" title={shown}>
            {shown}
          </span>
        </TextLink>
      ) : null}
      {website && !href ? (
        <span className="truncate" title={shown}>
          {shown}
        </span>
      ) : null}
      {measurement ? (
        <span>
          Tracked <DisplayTime value={measurement.completed_at} /> ·{' '}
          {measurement.logical_engines.join(', ')}
        </span>
      ) : null}
    </Inline>
  );
}

export function CompanyFacts({ data }: Readonly<{ data: CommandCenter }>) {
  const facts = data.facts;
  const offerings = facts.products_services.filter((label) => label.trim());
  return (
    <Card aria-labelledby="company-facts" className="h-full">
      <CardHeader
        actions={
          <>
            <span className={textRole('label')}>{facts.industry || 'Industry not set'}</span>
            <Button asChild variant="ghost">
              <ProjectLink href="/agent/context">
                Edit in Agent context <Icon icon={ArrowRight} />
              </ProjectLink>
            </Button>
          </>
        }
      >
        <CardTitle id="company-facts">Company facts</CardTitle>
      </CardHeader>
      <CardContent>
        <StatRow
          segments={[
            {
              key: 'positioning',
              label: 'Positioning',
              value: <FactSummary value={facts.positioning || facts.description} />,
            },
            {
              key: 'audience',
              label: 'Target audience',
              value: <FactSummary value={facts.target_audience} />,
            },
            {
              key: 'offerings',
              label: 'Offerings & competitors',
              value: offerings.length ? (
                <TagGroup labels={offerings} />
              ) : (
                <UnavailableValue state="not_set" />
              ),
              sub: pluralCount(facts.competitors.length, 'tracked competitor'),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function DashboardActions({
  activeProject,
  onEditProject,
  downloading,
  onDownload,
  layoutMenu,
}: Readonly<{
  activeProject: Project;
  onEditProject?: (project: Project) => void;
  downloading: boolean;
  onDownload: () => void;
  /** The layout menu, for members who can edit the Overview. */
  layoutMenu?: ReactNode;
}>) {
  return (
    // A fragment: the identity band owns the gap between route actions.
    <>
      <ProjectControls activeProject={activeProject} onEditProject={onEditProject} />
      {layoutMenu}
      <PdfButton downloading={downloading} onDownload={onDownload} />
    </>
  );
}

/** A free-text fact, cut at two lines with the whole text behind a tooltip. */
function FactSummary({ value }: Readonly<{ value: string }>) {
  if (!value.trim()) return <UnavailableValue state="not_set" />;
  return (
    // A value, so the primary ink under its grey label, not grey on grey.
    <ClampText lines={2} className={textRole('itemTitle')}>
      {value}
    </ClampText>
  );
}

function PdfButton({
  downloading,
  onDownload,
}: Readonly<{ downloading: boolean; onDownload: () => void }>) {
  return (
    <Button
      variant="secondary"
      onClick={onDownload}
      pending={downloading}
      pendingLabel="Preparing…"
    >
      <Icon icon={Download} />
      Export PDF
    </Button>
  );
}

type StateMetric = Readonly<{ value: number | null; delta: number | null }>;

/**
 * How each kind of Project state figure prints and changes. A rate is a whole
 * percent that moves in percent points; a rank is a place ("#3") that moves
 * in whole places and is better when it falls.
 */
const STATE_FIGURE = {
  rate: { format: percentFigure, unit: ' pp', precision: 1, policy: 'higher-is-better' },
  rank: { format: rankFigure, unit: '', precision: 0, policy: 'lower-is-better' },
} as const;

/**
 * One Project state figure. A missing value or a missing comparison has no
 * change to report; the Movement card states why once, rather than a dash
 * under every figure.
 */
function stateSegment({
  key,
  label,
  metric,
  kind,
}: Readonly<{
  key: string;
  label: string;
  metric: StateMetric;
  kind: keyof typeof STATE_FIGURE;
}>): StatSegment {
  const figure = STATE_FIGURE[kind];
  return {
    key,
    label,
    value: metric.value === null ? null : figure.format(metric.value),
    delta:
      metric.value !== null && metric.delta !== null ? (
        <Delta
          value={metric.delta}
          policy={figure.policy}
          precision={figure.precision}
          unit={figure.unit}
          {...VS_PREVIOUS_RUN}
        />
      ) : undefined,
  };
}

/** The metric names AI Visibility uses, so one run reads the same on both screens. */
export function ProjectStateCard({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card aria-labelledby="project-state" className="h-full">
      <CardHeader
        actions={<Badge>{data.measurement ? 'Citation-capable audit' : 'Not run'}</Badge>}
      >
        <CardTitle id="project-state">Project state</CardTitle>
      </CardHeader>
      <CardContent>
        <StatRow
          segments={[
            stateSegment({
              key: 'visibility',
              label: 'Visibility',
              metric: data.state.visibility,
              kind: 'rate',
            }),
            stateSegment({
              key: 'share',
              label: 'Share of voice',
              metric: data.state.share_of_voice,
              kind: 'rate',
            }),
            stateSegment({
              key: 'rank',
              label: 'Rank',
              metric: data.state.brand_rank,
              kind: 'rank',
            }),
          ]}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The brand's owned citation rate: the share of answers that link to a page
 * the brand owns. The projection's `track.citation_share` is the brand row's
 * `citation_rate`, which the API reads from the run's `owned_citation_rate`,
 * so it carries AI Visibility's name for that metric.
 */
export function Track({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card aria-labelledby="citation-share-track" className="h-full">
      <CardHeader
        actions={
          data.track.observed_at ? (
            <span className={textRole('label')}>
              {pluralCount(data.track.engine_coverage, 'engine')}
            </span>
          ) : null
        }
      >
        <CardTitle id="citation-share-track">Owned citation rate</CardTitle>
        {/* What the figure measures is the title's description, bound 4 under it. */}
        <CardDescription>Answers that link to a page you own</CardDescription>
      </CardHeader>
      <Stack as={CardContent} gap="tight">
        <MetricValue
          value={
            data.track.citation_share.value === null
              ? null
              : percentFigure(data.track.citation_share.value)
          }
          label={availabilityLabel(data.track.observed_at ? 'unavailable' : 'not_run')}
        />
        {/* The link shares the last line, so it adds no row of its own. */}
        <Inline className="justify-between">
          {/* No comparable run means no change; the Movement card says so once. */}
          {data.track.observed_at && data.track.citation_share.delta !== null ? (
            <div>
              <Delta value={data.track.citation_share.delta} unit=" pp" {...VS_PREVIOUS_RUN} />
            </div>
          ) : (
            <p className={textRole('caption')}>{data.track.limitations[0]}</p>
          )}
          <Button asChild variant="ghost">
            <ProjectLink href="/visibility?tab=trends">
              Open Trends <Icon icon={ArrowRight} />
            </ProjectLink>
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

/**
 * Each engine's change since the comparable run. With nothing comparable yet
 * the card holds one compact note rather than a tall empty block beside its
 * sibling. The note's action opens the Launch audit dialog, where the person
 * confirms the run; nothing starts from here. A comparable run that produced no movement rows is a different
 * answer: there is nothing to launch, only no change to show.
 */
export function Movement({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card aria-labelledby="movement" className="h-full">
      <CardHeader>
        <CardTitle id="movement">Movement</CardTitle>
      </CardHeader>
      <CardContent>
        {data.movements.length ? (
          <MovementChart movements={data.movements} />
        ) : (
          <NoMovement comparable={Boolean(data.measurement?.comparable_audit_id)} />
        )}
      </CardContent>
    </Card>
  );
}

function NoMovement({ comparable }: Readonly<{ comparable: boolean }>) {
  if (comparable)
    return <EmptyState variant="inline" icon={TrendingUp} title="No movement to show" />;
  return (
    <EmptyState
      variant="inline"
      icon={TrendingUp}
      title="No comparable measurement yet"
      primary={<LaunchAuditButton variant="secondary" />}
    />
  );
}

/** The shared, reorderable action list. */
export function RankedActionsCard({
  actions,
  pending,
  onMove,
}: Readonly<{
  actions: CommandCenter['actions'];
  pending: boolean;
  onMove: (from: number, to: number) => void;
}>) {
  if (!actions.length)
    return (
      <QueryState
        kind="empty"
        icon={ArrowRight}
        heading="No open actions"
        headingLevel={3}
        description="Run another audit to look for new opportunities."
        action={<ViewAllActions />}
      />
    );
  return (
    <Card aria-labelledby="ranked-actions" className="h-full">
      <CardHeader actions={<ViewAllActions />}>
        <CardTitle id="ranked-actions">Ranked actions</CardTitle>
        <CardDescription>Shared order · drag or use the arrow controls.</CardDescription>
      </CardHeader>
      <CardContent>
        <ReorderList items={actions.map(actionItem)} pending={pending} onMove={onMove} />
      </CardContent>
    </Card>
  );
}

/** What has been resolved since the comparable run. */
export function ProgressProofCard({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card aria-labelledby="progress-proof" className="h-full">
      <CardHeader>
        <CardTitle id="progress-proof">Progress and report proof</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={textRole('body')}>
          {pluralCount(data.resolved_actions.count, 'action')} resolved since the comparable run.
        </p>
      </CardContent>
    </Card>
  );
}

function ViewAllActions() {
  return (
    <Button asChild variant="ghost">
      <ProjectLink href="/agent/actions">
        View all <Icon icon={ArrowRight} />
      </ProjectLink>
    </Button>
  );
}
