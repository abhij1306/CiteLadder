import type { ReactNode } from 'react';
import { LaunchAuditButton } from '@/components/runs/launch-audit-button';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { ArrowRight, Download, TrendingUp } from '@/lib/icons';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { Button } from '@/components/ui/button';
import { Delta } from '@/components/ui/delta';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { ReorderList } from '@/components/ui/reorder-list';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { Absence } from '@/components/ui/absence';
import { pluralCount } from '@/lib/format';
import type { CommandCenter, Project } from '@citeladder/contracts';
import { comparisonBasis } from '@citeladder/contracts/comparison-reason';
import { DisplayTime } from '@/components/ui/display-time';
import { useEngineCatalog } from '@/lib/providers/engines';

import { ProjectControls } from './dashboard-controls';
import { formatRank } from '@/lib/visibility/dashboard';
import { actionItem, MovementChart, percentFigure, VS_PREVIOUS_RUN } from './dashboard-primitives';
import { ClampText } from '@/components/ui/clamp-text';
import { StateBlock } from '@/components/ui/state-block';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { WidgetFrame } from './widget-frame';

function websiteHref(website: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`;
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

export function ProjectMeta({ data }: Readonly<{ data: CommandCenter }>) {
  const website = data.project.website_url;
  const measurement = data.measurement;
  const engines = useEngineCatalog();
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
          {measurement.logical_engines.map(engines.label).join(', ')}
        </span>
      ) : null}
    </Inline>
  );
}

export function CompanyFacts({ data }: Readonly<{ data: CommandCenter }>) {
  const facts = data.facts;
  const offerings = facts.products_services.filter((label) => label.trim());
  return (
    <WidgetFrame
      id="company-facts"
      title="Company facts"
      description={facts.industry.trim() || <Absence state="not_set" label="Industry not set" />}
      link={{ href: '/agent/context', label: 'Edit in Agent context' }}
    >
      <FigureStrip
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
            value: <FactSummary value={offerings.join(', ')} />,
            sub: pluralCount(facts.competitors.length, 'tracked competitor'),
          },
        ]}
      />
    </WidgetFrame>
  );
}

export function DashboardActions({
  activeProject,
  onEditProject,
  downloading,
  onDownload,
  layoutMenu,
  launch = true,
}: Readonly<{
  activeProject: Project;
  onEditProject?: (project: Project) => void;
  downloading: boolean;
  onDownload: () => void;
  layoutMenu?: ReactNode;
  launch?: boolean;
}>) {
  return (
    <>
      <ProjectControls activeProject={activeProject} onEditProject={onEditProject} />
      <div data-in-more="" hidden>
        {layoutMenu}
        <PdfButton downloading={downloading} onDownload={onDownload} />
      </div>
      {launch ? (
        <MastheadPrimary>
          <LaunchAuditButton />
        </MastheadPrimary>
      ) : null}
    </>
  );
}

function FactSummary({ value }: Readonly<{ value: string }>) {
  if (!value.trim()) return <Absence state="not_set" />;
  return (
    <ClampText lines={2} className={textRole('body', 'whitespace-normal')}>
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

const STATE_FIGURE = {
  rate: { format: percentFigure, unit: ' pp', precision: 1, policy: 'higher-is-better' },
  rank: { format: formatRank, unit: '', precision: 0, policy: 'lower-is-better' },
} as const;

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
}>): FigureSegment {
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

export function ProjectStateCard({ data }: Readonly<{ data: CommandCenter }>) {
  const basis = data.measurement
    ? comparisonBasis({
        status: data.measurement.comparison_status,
        answers: data.measurement.comparison_answers,
      })
    : null;
  const note = basis?.kind === 'matched_subset' ? basis.note : undefined;
  return (
    <WidgetFrame id="project-state" title="Project state" fill="figure">
      <FigureStrip
        segments={[
          {
            ...stateSegment({
              key: 'visibility',
              label: 'Visibility',
              metric: data.state.visibility,
              kind: 'rate',
            }),
            sub: note,
          },
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
          ownedCitationSegment(data),
        ]}
      />
    </WidgetFrame>
  );
}

function ownedCitationSegment({ track }: Pick<CommandCenter, 'track'>): FigureSegment {
  const observed = Boolean(track.observed_at);
  return {
    key: 'citation-share',
    label: 'Owned citation rate',
    action: { href: '/insights?metric=owned_citation_rate', label: 'Open Insights' },
    caption: observed ? pluralCount(track.engine_coverage, 'engine') : undefined,
    value: track.citation_share.value === null ? null : percentFigure(track.citation_share.value),
    missingState: observed ? 'unavailable' : 'not_run',
    delta:
      observed && track.citation_share.delta !== null ? (
        <Delta value={track.citation_share.delta} unit=" pp" {...VS_PREVIOUS_RUN} />
      ) : undefined,
    sub: track.limitations[0],
  };
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
    <WidgetFrame
      id="movement"
      title="Movement"
      fill={data.movements.length ? 'chart' : 'list'}
      card={data.movements.length > 0}
    >
      {data.movements.length ? (
        <MovementChart movements={data.movements} />
      ) : (
        <NoMovement measurement={data.measurement} />
      )}
    </WidgetFrame>
  );
}

function NoMovement({ measurement }: Readonly<{ measurement: CommandCenter['measurement'] }>) {
  const canRun = useWorkspaceCapability('run');
  const note = (message: string) => (
    <StateBlock kind="empty" inline icon={TrendingUp} message={message} />
  );
  const declined = (message: string) =>
    note(canRun ? `${message} Launch run to measure movement.` : message);
  if (!measurement) return declined('No measured run yet.');
  const basis = comparisonBasis({
    status: measurement.comparison_status,
    answers: measurement.comparison_answers,
  });
  switch (basis.kind) {
    case 'comparable':
      return note('No movement to show');
    case 'matched_subset':
      return note(`${basis.note}; per-engine movement needs a fully comparable run.`);
    case 'declined':
      return declined(basis.reason);
    default: {
      const unreachable: never = basis;
      return unreachable;
    }
  }
}

export function RankedActionsCard({
  actions,
  pending,
  onMove,
}: Readonly<{
  actions: CommandCenter['actions'];
  pending: boolean;
  onMove: (from: number, to: number) => void;
}>) {
  return (
    <WidgetFrame
      id="ranked-actions"
      title="Ranked actions"
      link={{ href: '/actions', label: 'View all' }}
    >
      {actions.length ? (
        <ReorderList items={actions.map(actionItem)} pending={pending} onMove={onMove} />
      ) : (
        <StateBlock kind="empty" icon={ArrowRight} heading="No open actions" />
      )}
    </WidgetFrame>
  );
}
