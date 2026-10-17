import { useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { visibilitySchema } from '@citeladder/contracts/visibility';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import type { AnalyticsSelection } from '@citeladder/contracts/mcp-app';
import { logicalEngineSchema } from '@citeladder/contracts/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { TrendChart } from '@/components/ui/trend-chart';
import { Label, Metric, textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { appPolicy } from './config';
import type { AppState, Controller } from './controller';
import { SourcesView, SiteHealthView } from './evidence-views';
import { day, moment, rate } from './format';

const views = [
  { value: 'overview', label: 'Overview' },
  { value: 'trends', label: 'Trends' },
  { value: 'sources', label: 'Sources' },
  { value: 'site_health', label: 'Site Health' },
] as const;

function Overview({
  data,
  selection,
  selectCompetitor,
}: Readonly<{
  data: unknown;
  selection: AnalyticsSelection;
  selectCompetitor: Controller['selectCompetitor'];
}>) {
  const parsed = visibilitySchema.safeParse(data);
  if (!parsed.success) {
    const unavailable = z
      .object({ state: z.literal('unavailable'), reason: z.literal('no_completed_measurement') })
      .safeParse(data);
    return (
      <p role={unavailable.success ? undefined : 'alert'} className={textRole('body')}>
        {unavailable.success
          ? 'No completed measurement. Run a measurement in CiteLadder, then return.'
          : 'Visibility evidence is unavailable. Retry or reconnect.'}
      </p>
    );
  }
  const projection = parsed.data;
  return (
    <div className="space-y-4">
      <Select
        ariaLabel="Overview competitor"
        value={selection.competitor ?? ''}
        options={[
          { value: '', label: 'All brands' },
          ...projection.rankings
            .filter((row) => !row.is_brand)
            .map((row) => ({ value: row.name, label: row.name })),
        ]}
        onValueChange={(competitor) => selectCompetitor(competitor || null)}
      />
      <div className="flex flex-wrap gap-6">
        <div>
          <Label>Brand mention rate</Label>
          <div>
            <Metric>{rate(projection.visibility_rate)}</Metric>
          </div>
        </div>
        <div>
          <Label>Owned citation rate</Label>
          <div>
            <Metric>{rate(projection.owned_citation_rate)}</Metric>
          </div>
        </div>
      </div>
      <p className={textRole('caption')}>
        Observed {moment(projection.created_at)} ·{' '}
        {projection.counts?.state ?? projection.audit_status} · {projection.total_completed}{' '}
        responses · comparison: {projection.comparison?.status ?? 'unavailable'}
      </p>
      <p className={textRole('caption')}>
        Analyzer {projection.analyzer_version} · scoring {projection.scoring_rule_version} ·{' '}
        {projection.counts?.expected ?? 'Unknown'} expected / {projection.total_failed} failed
      </p>
      <p className={textRole('caption')}>
        {projection.model_provenance.length
          ? projection.model_provenance
              .map(
                (route) =>
                  `${route.logical_engine}: ${route.transport_model}, retrieval ${route.retrieval_enabled ?? 'unknown'}`,
              )
              .join(' · ')
          : 'Model and retrieval provenance unavailable'}
      </p>
      <EditorialSectionHeader title="Brand and competitors" />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Mentions</TableHead>
            <TableHead>Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projection.rankings.map((row) => (
            <TableRow key={row.name} highlight={row.name === selection.competitor}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{rate(row.mention_rate)}</TableCell>
              <TableCell>{rate(row.citation_rate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className={textRole('caption')}>
        Rates describe observed answers, not causal impact. Model/retrieval conditions and coverage
        determine comparison eligibility.
      </p>
    </div>
  );
}

function Trends({
  data,
  selection,
  select,
  selectCompetitor,
}: Readonly<{
  data: Record<string, unknown>;
  selection: AnalyticsSelection;
  select: Controller['select'];
  selectCompetitor: Controller['selectCompetitor'];
}>) {
  const [metric, setMetric] = useState<string>('brand_mention_rate');
  const parsed = visibilityTrendListSchema.safeParse(data.points);
  if (!parsed.success)
    return (
      <p role="alert" className={textRole('body')}>
        Visibility history is unavailable. Retry or reconnect.
      </p>
    );
  const points = parsed.data;
  const competitors = [
    ...new Set(
      points.flatMap((point) =>
        point.rankings.filter((row) => !row.is_brand).map((row) => row.name),
      ),
    ),
  ];
  const value = (point: (typeof points)[number]) => {
    if (selection.competitor) {
      const field = metric === 'brand_mention_rate' ? 'mention_rate' : 'citation_rate';
      return point.rankings.find((row) => row.name === selection.competitor)?.[field] ?? null;
    }
    return metric === 'brand_mention_rate' ? point.brand_mention_rate : point.owned_citation_rate;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select
          ariaLabel="Trend metric"
          value={metric}
          options={appPolicy.metrics}
          onValueChange={setMetric}
        />
        <Select
          ariaLabel="Competitor"
          value={selection.competitor ?? ''}
          options={[
            { value: '', label: 'Your brand' },
            ...competitors.map((name) => ({ value: name, label: name })),
          ]}
          onValueChange={(competitor) => selectCompetitor(competitor || null)}
        />
      </div>
      <TrendChart
        label="Observed visibility history"
        domainMax={1}
        formatTick={rate}
        data={points.map((point, index) => {
          const previous = points[index - 1];
          return {
            label: day(point.completed_at),
            value: value(point),
            breakBefore:
              previous !== undefined &&
              (!point.comparison_key ||
                point.comparison_key !== previous.comparison_key ||
                JSON.stringify(point.analyzer_versions) !==
                  JSON.stringify(previous.analyzer_versions) ||
                JSON.stringify(point.scoring_rule_versions) !==
                  JSON.stringify(previous.scoring_rule_versions)),
          };
        })}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Completed</TableHead>
            <TableHead>Rate</TableHead>
            <TableHead>Coverage / model</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.source_snapshot_ids.join(',')}>
              <TableCell>{moment(point.completed_at)}</TableCell>
              <TableCell>{rate(value(point))}</TableCell>
              <TableCell>
                {point.counts?.state ?? 'unknown'} · {point.transport_model ?? 'mixed / unknown'} ·
                retrieval {String(point.retrieval_enabled)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  disabled={!point.audit_id}
                  onClick={() =>
                    void select({
                      ...selection,
                      view: 'sources',
                      audit_id: point.audit_id,
                      from_at: null,
                      to_at: null,
                      transport_model: null,
                      retrieval_enabled: null,
                      competitor: null,
                    })
                  }
                >
                  Sources for this audit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!points.length && <p className={textRole('body')}>No measured runs in this window.</p>}
      <p className={textRole('caption')}>
        Gaps and changed comparison identities break the line. Sources drill-down selects one
        concrete audit from this window.
      </p>
    </div>
  );
}

/** Human scope label. Selections carry IDs for reads; the UI never shows them. */
function evidenceLabel(
  selection: AnalyticsSelection,
  evidence: Record<string, unknown> | undefined,
) {
  switch (selection.view) {
    case 'site_health':
      return evidence?.observed_at
        ? `Site Health snapshot of ${day(evidence.observed_at)}`
        : 'Latest Site Health snapshot';
    case 'trends':
      return selection.from_at && selection.to_at
        ? `${day(selection.from_at)} to ${day(selection.to_at)}`
        : `Last ${appPolicy.historyDays} days`;
    case 'overview':
    case 'sources':
      if (evidence?.created_at) return `Audit of ${day(evidence.created_at)}`;
      return selection.audit_id ? 'Selected audit' : 'Latest audit';
  }
}

function viewContent(view: AnalyticsSelection['view'], state: AppState, controller: Controller) {
  if (!state.result || !state.selection) return null;
  const selection = state.selection;
  switch (view) {
    case 'overview':
      return (
        <Overview
          data={state.result.evidence}
          selection={selection}
          selectCompetitor={controller.selectCompetitor}
        />
      );
    case 'trends':
      return (
        <Trends
          data={state.result.evidence}
          selection={selection}
          select={controller.select}
          selectCompetitor={controller.selectCompetitor}
        />
      );
    case 'sources':
      return <SourcesView state={state} controller={controller} />;
    case 'site_health':
      return (
        <SiteHealthView
          key={`${selection.project_id}:${selection.snapshot_id}`}
          state={state}
          controller={controller}
        />
      );
  }
}

export function Analytics({ controller }: Readonly<{ controller: Controller }>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const selection = state.selection;
  const project = state.projects.find((item) => item.id === selection?.project_id);
  const changeView = (view: AnalyticsSelection['view']) => {
    if (!selection) return;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - appPolicy.historyDays * 86400000).toISOString();
    void controller.select({
      ...selection,
      view,
      cursor: null,
      domain: null,
      level: 'domain',
      competitor: null,
      snapshot_id: view === 'site_health' ? selection.snapshot_id : null,
      audit_id: view === 'trends' || view === 'site_health' ? null : selection.audit_id,
      from_at: view === 'trends' ? from : null,
      to_at: view === 'trends' ? to : null,
      transport_model: null,
      retrieval_enabled: null,
      engine: view === 'site_health' ? null : selection.engine,
      cohort: view === 'site_health' ? 'core' : selection.cohort,
    });
  };
  return (
    <main className="space-y-4 p-4">
      <h1 className={textRole('pageTitle')}>CiteLadder analytics</h1>
      <div className="flex flex-wrap gap-3">
        <Select
          ariaLabel="Project and workspace"
          value={selection?.project_id ?? ''}
          options={[
            { value: '', label: 'Select a project' },
            ...state.projects.map((project) => ({
              value: project.id,
              label: `${project.workspace_name} / ${project.name}`,
            })),
          ]}
          onValueChange={(project_id) => {
            if (project_id) void controller.select({ project_id, view: 'overview' });
          }}
        />
        <Button variant="secondary" onClick={() => void controller.loadProjects()}>
          Refresh connection
        </Button>
        {state.projectCursor && (
          <Button variant="ghost" onClick={() => void controller.loadProjects(state.projectCursor)}>
            More projects
          </Button>
        )}
      </div>
      {state.error && (
        <div role="alert" className={textRole('body')}>
          {state.error}
          <Button
            variant="ghost"
            onClick={() =>
              selection ? void controller.select(selection) : void controller.loadProjects()
            }
          >
            Retry
          </Button>
        </div>
      )}
      {state.busy && <output className={textRole('body')}>Loading persisted evidence…</output>}
      {!selection && (
        <p className={textRole('body')}>
          Connect your account and select a project. If you have no projects, complete onboarding in
          CiteLadder.
        </p>
      )}
      {selection && (
        <>
          <p className={textRole('caption')}>
            {project ? `${project.name} · ` : ''}
            {evidenceLabel(selection, state.result?.evidence)}
          </p>
          {selection.view !== 'site_health' && (
            <div className="flex flex-wrap gap-3">
              <Select
                ariaLabel="Engine"
                value={selection.engine ?? ''}
                options={[
                  { value: '', label: 'All engines' },
                  ...logicalEngineSchema.options.map((engine) => ({
                    value: engine,
                    label: engine,
                  })),
                ]}
                onValueChange={(engine) =>
                  void controller.select({ ...selection, engine: engine || null, cursor: null })
                }
              />
              <Select
                ariaLabel="Cohort"
                value={selection.cohort}
                options={[
                  { value: 'core', label: 'Core' },
                  { value: 'comparison', label: 'Comparison' },
                ]}
                onValueChange={(cohort) =>
                  void controller.select({ ...selection, cohort, cursor: null })
                }
              />
            </div>
          )}
          {selection.view === 'trends' && (
            <div className="flex flex-wrap gap-3">
              <Input
                type="date"
                aria-label="Period start"
                value={selection.from_at?.slice(0, 10) ?? ''}
                onChange={(event) => {
                  if (event.target.value)
                    void controller.select({
                      ...selection,
                      from_at: `${event.target.value}T00:00:00Z`,
                    });
                }}
              />
              <Input
                type="date"
                aria-label="Period end"
                value={selection.to_at?.slice(0, 10) ?? ''}
                onChange={(event) => {
                  if (event.target.value)
                    void controller.select({
                      ...selection,
                      to_at: `${event.target.value}T23:59:59.999999Z`,
                    });
                }}
              />
            </div>
          )}
          <Tabs
            ariaLabel="Analytics view"
            items={views.map((view) => ({
              ...view,
              disabled: view.value === 'sources' && selection.view === 'trends',
            }))}
            value={selection.view}
            onValueChange={changeView}
          >
            {views.map((view) => (
              <TabPanel key={view.value} value={view.value}>
                {viewContent(view.value, state, controller)}
              </TabPanel>
            ))}
          </Tabs>
        </>
      )}
      {state.result?.links && (
        <Button asChild variant="secondary">
          <a href={state.result.links.application} target="_blank" rel="noreferrer">
            Open CiteLadder
          </a>
        </Button>
      )}
      {state.result?.links && (
        <Button asChild variant="ghost">
          <a href={state.result.links.onboarding} target="_blank" rel="noreferrer">
            Set up a project
          </a>
        </Button>
      )}
    </main>
  );
}
