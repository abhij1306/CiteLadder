import type { ProbeObjectionsValue } from '@citeladder/contracts/probes';

import { ObjectionActions } from '@/components/perception/objection-actions';
import { Absence } from '@/components/ui/absence';
import { buttonClasses } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Disclosure } from '@/components/ui/disclosure';
import { ProbeLede } from '@/components/perception/probe-lede';
import type { FigureSegment } from '@/components/ui/figure-strip';
import { Stack } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { Sparkline } from '@/components/ui/sparkline';
import { StateBlock } from '@/components/ui/state-block';
import { StatusMark } from '@/components/ui/status-mark';
import {
  TableActionsCell,
  TableCell,
  TableCellLines,
  TableRow,
  UrlText,
} from '@/components/ui/table';
import { agentHandoffHref } from '@/lib/agent/handoff';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { pluralCount } from '@/lib/format';
import { objectionsSummary } from '@/lib/perception/probe';
import { useWorkspaceCapability } from '@/lib/project/project-scope';
import { classificationBadgeValue, classificationLabel } from '@/lib/runs/status';
import { standingLabel } from '@/lib/visibility/source-pages';
import { typeLabel } from '@/lib/visibility/sources';

type Group = ProbeObjectionsValue['groups'][number];

const OBJECTION_SKILL = 'objection_sources';

export function PerceptionObjections({
  scope,
  data,
}: Readonly<{ scope: ProjectScope; data: ProbeObjectionsValue }>) {
  return (
    <>
      <Lede data={data} />
      <ObjectionTable scope={scope} data={data} />
      <ObjectionSources groups={data.groups} />
    </>
  );
}

function Lede({ data }: Readonly<{ data: ProbeObjectionsValue }>) {
  const { raised, widest, headline } = objectionsSummary(data);
  const segments: FigureSegment[] = [
    {
      key: 'found',
      label: 'Objections found',
      value: String(raised.length),
      sub: `Grouped from ${pluralCount(data.answers, 'answer')}`,
    },
    {
      key: 'widest',
      label: 'Raised by most engines',
      value: widest ? `${widest.engines.length} of ${data.answered_by.length}` : null,
      sub: widest?.name,
    },
    {
      key: 'average',
      label: 'Average position score',
      value: data.average === null ? null : String(data.average),
      sub: '100 means always raised first',
    },
  ];
  return (
    <ProbeLede
      createdAt={data.probe.created_at}
      headline={headline}
      label="Objections"
      segments={segments}
    />
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'objection', label: 'Objection' },
  { key: 'score', label: 'Position score', kind: 'number', width: 'metric' },
  { key: 'engines', label: 'Engines', kind: 'number', width: 'shortMetric' },
  { key: 'trend', label: 'Trend', sublabel: 'Recent probes', width: 'metric' },
  { key: 'sources', label: 'Sources', kind: 'number', width: 'shortMetric' },
  { key: 'actions', label: 'Actions', kind: 'actions' },
];

function ObjectionTable({
  scope,
  data,
}: Readonly<{ scope: ProjectScope; data: ProbeObjectionsValue }>) {
  const mayEdit = useWorkspaceCapability('write');
  return (
    <TitledSection
      title={`Why buyers might not choose ${data.brand}`}
      description="Higher score is raised earlier"
    >
      <DataTable
        label="Objections"
        columns={COLUMNS}
        state={
          data.groups.length
            ? undefined
            : { kind: 'empty', inline: true, message: 'No objections raised.' }
        }
      >
        {data.groups.map((group) => (
          <TableRow key={group.id}>
            <TableCell>{group.name}</TableCell>
            <TableCell numeric>{group.score ?? <Absence label="No answers" />}</TableCell>
            <TableCell numeric>
              {data.answered_by.length ? (
                `${group.engines.length} of ${data.answered_by.length}`
              ) : (
                <Absence label="No answers" />
              )}
            </TableCell>
            <TableCell>
              {group.history.length > 1 ? (
                <Sparkline
                  values={group.history}
                  label={`${group.name}: position score over the last ${group.history.length} probes, oldest first: ${group.history.map((value) => value ?? 'no answers').join(', ')}`}
                />
              ) : (
                <Absence state="not_run" label="No previous probe" />
              )}
            </TableCell>
            <TableCell numeric>
              <Sources sources={group.sources} />
            </TableCell>
            <TableActionsCell>
              <ProjectLink
                href={agentHandoffHref({
                  objectionGroupId: group.id,
                  skillId: OBJECTION_SKILL,
                  prompt: `Help me answer the objection "${group.name}".`,
                })}
                aria-label={`Ask agent about ${group.name}`}
                className={buttonClasses('quiet')}
              >
                Ask agent
              </ProjectLink>
              {mayEdit ? (
                <ObjectionActions
                  scope={scope}
                  group={group}
                  others={data.groups.filter((other) => other.id !== group.id)}
                />
              ) : null}
            </TableActionsCell>
          </TableRow>
        ))}
      </DataTable>
    </TitledSection>
  );
}

function Sources({ sources }: Readonly<{ sources: Group['sources'] }>) {
  if (sources === null) return <Absence state="not_applicable" label="Not raised" />;
  return sources || <Absence state="none" label="No sources" />;
}

const PAGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'page', label: 'Page' },
  { key: 'page-type', label: 'Page type', width: 'category' },
  { key: 'type', label: 'Source type', width: 'category' },
  { key: 'mentions', label: 'Mentions you', width: 'category' },
  { key: 'citations', label: 'Citations', kind: 'number', width: 'shortMetric' },
];

function ObjectionSources({ groups }: Readonly<{ groups: readonly Group[] }>) {
  const cited = groups.filter((group) => group.pages.length > 0);
  return (
    <TitledSection
      title="Sources behind the objections"
      description="Pages engines cited while raising each objection"
    >
      <SectionContent>
        {cited.length ? (
          <Stack gap="item">
            {cited.map((group) => (
              <Disclosure
                key={group.id}
                title={[
                  group.name,
                  pluralCount(group.pages.length, 'page'),
                  ...(group.score === null ? [] : [`Score ${group.score}`]),
                ].join(' · ')}
              >
                <DataTable label={`Sources behind ${group.name}`} columns={PAGE_COLUMNS}>
                  {group.pages.map((page) => (
                    <TableRow key={page.url}>
                      <TableCell>
                        <TableCellLines
                          primary={page.title || page.domain}
                          secondary={<UrlText url={page.url} />}
                          secondaryTooltip={page.url}
                        />
                      </TableCell>
                      <TableCell>
                        {typeLabel(page.page_format, 'url') ?? <Absence state="not_measured" />}
                      </TableCell>
                      <TableCell>
                        <StatusMark
                          variant="classification"
                          value={classificationBadgeValue(page.classification)}
                        >
                          {classificationLabel(page.classification)}
                        </StatusMark>
                      </TableCell>
                      <TableCell>{standingLabel(page.standing)}</TableCell>
                      <TableCell numeric>{page.citations}</TableCell>
                    </TableRow>
                  ))}
                </DataTable>
              </Disclosure>
            ))}
          </Stack>
        ) : (
          <StateBlock kind="empty" inline message="No sources." />
        )}
      </SectionContent>
    </TitledSection>
  );
}
