import { ArrowRight, Download, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { ledgerClasses } from '@/components/ui/workspace';
import { ProjectLink } from '@/components/layout/scoped-link';

import { Badge } from '@/components/ui/badge';
import { TagGroup } from '@/components/ui/tag';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardEyebrow,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { QueryState } from '@/components/ui/query-state';
import { StatRow, type StatSegment } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { MetricValue } from '@/components/ui/metric-value';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { availabilityLabel, pluralCount } from '@/lib/format';
import type { CommandCenter, Project } from '@/lib/api/types';
import { DisplayTime } from '@/components/ui/display-time';

import { ProjectControls } from './dashboard-controls';
import { ActionRow, metricValue, MovementChart, VS_PREVIOUS_RUN } from './dashboard-primitives';
import { Tooltip } from '@/components/ui/tooltip';

function brandName(data: CommandCenter) {
  return data.project.brand_name || data.project.name;
}

/** The project's identity: logo, name, website and the run it was last tracked in. */
export function DashboardHeader({
  data,
  activeProject,
}: Readonly<{
  data: CommandCenter;
  activeProject: Project;
}>) {
  const website = data.project.website_url;
  return (
    <Card aria-labelledby="project-identity">
      <CardContent className="flex min-w-0 items-center gap-4">
        <BrandLogo
          name={brandName(data)}
          logoUrl={activeProject.brand.logo_url}
          websiteUrl={website}
          placement="identity"
        />
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id="project-identity" className="truncate">
              {brandName(data)}
            </CardTitle>
            {website ? (
              <TextLink
                variant="external"
                text="label"
                href={/^https?:\/\//i.test(website) ? website : `https://${website}`}
                className="min-w-0"
              >
                <span className="truncate">
                  {website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                </span>
              </TextLink>
            ) : null}
          </div>
          {data.measurement ? (
            <p className={textRole('caption')}>
              Tracked <DisplayTime value={data.measurement.completed_at} /> ·{' '}
              {data.measurement.logical_engines.join(', ')}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
                Edit in Agent context <ArrowRight className="ms-1 size-3.5" aria-hidden />
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
                <TagGroup labels={offerings} tone="purple" />
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
    <div className="flex flex-wrap items-center gap-2">
      <ProjectControls activeProject={activeProject} onEditProject={onEditProject} />
      {layoutMenu}
      <PdfButton downloading={downloading} onDownload={onDownload} />
    </div>
  );
}

/** A free-text fact, cut at two lines with the whole text behind a tooltip. */
function FactSummary({ value }: Readonly<{ value: string }>) {
  if (!value.trim()) return <UnavailableValue state="not_set" />;
  return (
    <Tooltip content={value}>
      <p className={textRole('body', 'line-clamp-2 overflow-hidden')}>{value}</p>
    </Tooltip>
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
      className="gap-2"
    >
      <Download className="size-3.5" aria-hidden />
      Export PDF
    </Button>
  );
}

/**
 * One Project state figure. A missing value or a missing comparison has no
 * change to report; the Movement card states why once, rather than a dash
 * under every figure.
 */
function stateSegment(
  key: string,
  label: string,
  metric: Readonly<{ value: number | null; delta: number | null }>,
  suffix: string,
  inverse = false,
): StatSegment {
  return {
    key,
    label,
    value: metric.value === null ? null : metricValue(metric.value, suffix),
    delta:
      metric.value !== null && metric.delta !== null ? (
        <Delta
          value={metric.delta}
          policy={inverse ? 'lower-is-better' : 'higher-is-better'}
          {...VS_PREVIOUS_RUN}
        />
      ) : undefined,
  };
}

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
            stateSegment('visibility', 'Visibility', data.state.visibility, '%'),
            stateSegment('share', 'Share of voice', data.state.share_of_voice, '%'),
            stateSegment('rank', 'Brand rank', data.state.brand_rank, '', true),
          ]}
        />
      </CardContent>
    </Card>
  );
}

const RECOMMENDED = { status: 'Action recommended', link: 'Continue' };

/** Every step the server can name; steps that are not a call to act say what they are. */
const NEXT_ACTION_COPY: Record<
  CommandCenter['next_action']['kind'],
  { status: string; link: string }
> = {
  opportunity: RECOMMENDED,
  connect: RECOMMENDED,
  crawl: RECOMMENDED,
  configure_prompts: RECOMMENDED,
  audit: RECOMMENDED,
  audit_running: { status: 'In progress', link: 'View progress' },
  monitor: { status: 'Up to date', link: 'View trends' },
};

export function NextAction({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card
      tone="recommendation"
      aria-labelledby="next-action"
      className="text-foreground flex h-full flex-col justify-between"
    >
      <CardHeader
        actions={
          <span className={textRole('label')}>
            {NEXT_ACTION_COPY[data.next_action.kind].status}
          </span>
        }
      >
        <CardEyebrow>Next action</CardEyebrow>
        <CardTitle id="next-action">{data.next_action.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button asChild variant="primary" size="md">
          <ProjectLink href={data.next_action.href}>
            {NEXT_ACTION_COPY[data.next_action.kind].link}
            <ArrowRight className="size-4" aria-hidden />
          </ProjectLink>
        </Button>
      </CardContent>
    </Card>
  );
}

export function Track({ data }: Readonly<{ data: CommandCenter }>) {
  return (
    <Card aria-labelledby="citation-share-track" className="flex h-full flex-col justify-between">
      <CardHeader
        actions={
          data.track.observed_at ? (
            <span className={textRole('label')}>
              {pluralCount(data.track.engine_coverage, 'engine')}
            </span>
          ) : null
        }
      >
        <CardTitle id="citation-share-track">Citation share</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <span className={textRole('label')}>AI Visibility Track</span>
        <MetricValue
          value={
            data.track.citation_share.value === null
              ? null
              : metricValue(data.track.citation_share.value, '%')
          }
          label={availabilityLabel(data.track.observed_at ? 'unavailable' : 'not_run')}
        />
        {/* No comparable run means no change; the Movement card says so once. */}
        {data.track.observed_at && data.track.citation_share.delta !== null ? (
          <div>
            <Delta value={data.track.citation_share.delta} {...VS_PREVIOUS_RUN} />
          </div>
        ) : (
          <p className={textRole('caption')}>{data.track.limitations[0]}</p>
        )}
      </CardContent>
      <CardContent className="flex justify-end">
        <Button asChild variant="ghost">
          <ProjectLink href="/visibility?tab=trends">
            Open Trends <ArrowRight className="ms-1 size-3.5" aria-hidden />
          </ProjectLink>
        </Button>
      </CardContent>
    </Card>
  );
}

/** With nothing comparable yet the section is wholly empty, so the empty state stands alone. */
export function Movement({ data }: Readonly<{ data: CommandCenter }>) {
  if (data.movements.length === 0)
    return (
      <QueryState
        kind="empty"
        icon={TrendingUp}
        heading="No comparable measurement yet"
        description="Needs a second run with the same prompts and engines."
      />
    );
  return (
    <Card aria-labelledby="movement" className="h-full">
      <CardHeader>
        <CardTitle id="movement">Movement</CardTitle>
      </CardHeader>
      <CardContent>
        <MovementChart movements={data.movements} />
      </CardContent>
    </Card>
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
        <ol className={ledgerClasses('open')}>
          {actions.map((action, index) => (
            <ActionRow
              key={action.id}
              action={action}
              index={index}
              total={actions.length}
              onMove={onMove}
              onDrop={onMove}
              reorderPending={pending}
            />
          ))}
        </ol>
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
        View all <ArrowRight className="ms-1 size-3.5" aria-hidden />
      </ProjectLink>
    </Button>
  );
}
